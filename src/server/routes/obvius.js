/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * This file implements the /api/obvius route. This route accepts data from
 * Obvius meters, handling parameters passed in form/multipart, GET parameters,
 * or POST body parameters.
 *
 * STATUS mode requests are logged.
 *
 * CONFIGFILEMANIFEST requests are responded to with a dummy manifest which specifies
 * 					  a lack of config files to respond with.
 */

const express = require('express');
const config = require('../config');
const multer = require('multer');
const moment = require('moment');
const md5 = require('md5');
const zlib = require('zlib');
const { log } = require('../log');
const Configfile = require('../models/obvius/Configfile');
const listConfigfiles = require('../services/obvius/listConfigfiles');
const streamBuffers = require('stream-buffers');
const loadLogfileToReadings = require('../services/obvius/loadLogfileToReadings');
const middleware = require('../middleware');
const obvius = require('../util').obvius;
const { getConnection, dropConnection } = require('../db');

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

// Here, the use of upload.array() allows the lowercaseParams middleware to
// integrate form/multipart data into the generic parameter pipeline along with
// POST and GET params.
router.use(upload.any(), middleware.lowercaseAllParamNames);
router.use(middleware.paramsLookupMixin);

/**
 * Inform the client of a failure (406 Not Acceptable), and log it.
 *
 * @param {express.Request} req The Express request object
 * @param {express.Response} res The Express response object
 * @param {string} reason The reason for the failure.
 *
 */
function failure(req, res, reason = '') {
	const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
	log.error(`Obvius protocol request from ${ip} failed due to ${reason}`);

	res.status(406) // 406 Not Acceptable error, as required by Obvius
		.send(`<pre>\n${reason}\n</pre>\n`);
}

/**
 * Inform the client of a success (200 OK).
 *
 * @param {express.Request} req The Express request object
 * @param {express.Response} res The Express response object
 * @param {string} comment Any additional data to be returned to the client.
 *
 */
function success(req, res, comment = '') {
	res.status(200) // 200 OK
		.send(`<pre>\nSUCCESS\n${comment}</pre>\n`);
}

/**
 * Logs a STATUS request for later examination.
 * @param {express.Request} req the request to process (must have the req.param mixin)
 * @param {express.Response} res the response object
 */
function handleStatus(req, res) {
	// Grab the IP of the requester.
	const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
	// These are all the params OED cares about. They just get logged.
	// Note that this route does NOT log the password, for security reasons.
	const paramNames = ['MODE', 'SENDDATATRACE', 'SERIALNUMBER', 'GSMSIGNAL',
		'LOOPNAME', 'UPTIME', 'PERCENTBLOCKSINUSE', 'PERCENTINODESINUSE',
		'UPLOADATTEMPT', 'ACQUISUITEVERSION', 'USRVERSION', 'ROOTVERSION',
		'KERNELVERSION', 'FIRMWAREVERSION', 'BOOTCOUNT', 'BATTERYGOOD'];
	// Build a log entry for this request
	let s = `Handling request from ${ip}\n`;
	for (const paramName of paramNames) {
		if (req.param(paramName) !== false && req.param(paramName) !== undefined) {
			s += `\tGot ${paramName}: ${req.param(paramName)}\n`;
		} else {
			s += `\tNo ${paramName} submitted\n`;
		}
	}
	log.info(s);

	success(req, res);
}

/**
 * Handle an Obvius upload request.
 * Unfortunately the Obvious API does not specify a HTTP verb.
 */
router.all('/', async (req, res) => {
	// Log the IP of the requester
	const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
	log.info(`Received Obvious protocol request from ${ip}`);

	// Attempt to verify the password
	if (!req.param('password')) {
		failure(req, res, 'password parameter is required.');
		return;
	} else if (req.param('password') !== config.obvius.password) {
		failure(req, res, 'password was not correct.');
		return;
	}

	const mode = req.param('mode', false);
	if (mode === false) {
		failure(req, res, 'Request must include mode parameter.');
		return;
	}

	if (mode === obvius.mode.status) {
		handleStatus(req, res);
		return;
	}

	if (mode === obvius.mode.logfile_upload) {
		if (!req.param('serialnumber', false)) {
			failure(req, res, 'Logfile Upload Requires Serial Number');
			return;
		}
		const conn = getConnection();
		for (const fx of req.files) {
			log.info(`Received ${fx.fieldname}: ${fx.originalname}`);
			// Logfiles are always gzipped.
			let data;
			try {
				data = zlib.gunzipSync(fx.buffer);
			} catch (err) {
				log.error(err);
				failure(req, res, `Unable to gunzip incoming buffer: ${err}`);
				return;
			}
			loadLogfileToReadings(req.param('serialnumber'), ip, data, conn);
		}
		dropConnection();

		success(req, res, 'Logfile Upload IS PROVISIONAL');
		return;
	}

	if (mode === obvius.mode.config_file_download) {
		failure(req, res, 'Config Download Not Implemented');
		return;
	}

	if (mode === obvius.mode.config_file_manifest) {
		const conn = getConnection();
		success(req, res, await listConfigfiles(conn));
		dropConnection();
		return;
	}

	if (mode === obvius.mode.config_file_upload) {
		// Check required parameters
		if (!req.param('serialnumber', false)) {
			failure(req, res, 'Config Upload Requires Serial Number');
			return;
		}
		if (!req.param('modbusdevice', false)) {
			failure(req, res, 'Config Upload Requires Modbus Device ID');
			return;
		}
		const conn = getConnection();
		for (const fx of req.files) {
			log.info(`Received ${fx.fieldname}: ${fx.originalname}`);

			let data;
			try {
				data = zlib.gunzipSync(fx.buffer).toString('utf-8');
			} catch (error) {
				data = fx.buffer.toString('utf-8');
			}

			const cf = new Configfile(undefined, req.param('serialnumber'), req.param('modbusdevice'), moment(), md5(data), data, true);
			await cf.insert(conn);
			success(req, res, `Acquired config log with (pseudo)filename ${cf.makeFilename()}.`);
		}
		dropConnection();
		return;
	}

	if (mode === obvius.mode.test) {
		failure(req, res, 'Test Not Implemented');
		return;
	}

	failure(req, res, `Unknown mode '${mode}'`);
});

module.exports = router;