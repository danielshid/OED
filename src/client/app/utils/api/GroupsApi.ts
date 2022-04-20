/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import ApiBackend from './ApiBackend';
import * as moment from 'moment';
import { CompareReadings } from '../../types/readings';
import { NamedIDItem } from '../../types/items';
import { TimeInterval } from '../../../../common/TimeInterval';
import { GroupData, GroupID } from '../../types/redux/groups';

export default class GroupsApi {
	private readonly backend: ApiBackend;

	constructor(backend: ApiBackend) {
		this.backend = backend;
	}

	public async details(): Promise<NamedIDItem[]> {
		return await this.backend.doGetRequest<NamedIDItem[]>('/api/groups');
	}

	public async children(groupID: number): Promise<{meters: number[], groups: number[], deepMeters: number[]}> {
		return await this.backend.doGetRequest<{meters: number[], groups: number[], deepMeters: number[]}>(`api/groups/children/${groupID}`);
	}

	public async compareReadings(groupIDs: number[], timeInterval: TimeInterval, shift: moment.Duration):
	Promise<CompareReadings> {
		const stringifiedIDs = groupIDs.join(',');
		const currStart: moment.Moment = timeInterval.getStartTimestamp();
		const currEnd: moment.Moment = timeInterval.getEndTimestamp();
		return await this.backend.doGetRequest<CompareReadings>(
			`/api/compareReadings/groups/${stringifiedIDs}`,
			{
				curr_start: currStart.toISOString(),
				curr_end: currEnd.toISOString(),
				shift: shift.toISOString()
			}
		);
	}

	public async create(groupData: GroupData): Promise<void> {
		return await this.backend.doPostRequest<void>('api/groups/create', groupData);
	}

	public async edit(group: GroupData & GroupID): Promise<void> {
		return await this.backend.doPutRequest<void>('api/groups/edit', group);
	}

	public async delete(groupID: number) {
		return await this.backend.doPostRequest('api/groups/delete', {id: groupID});
	}
}
