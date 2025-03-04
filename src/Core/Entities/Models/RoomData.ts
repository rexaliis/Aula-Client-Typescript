﻿import {ThrowHelper} from "../../../Common/ThrowHelper.js";
import {SealedClassError} from "../../../Common/SealedClassError.js";

export class RoomData
{
	readonly #id: string;
	readonly #name: string;
	readonly #description: string | null;
	readonly #isEntrance: boolean;
	readonly #connectedRoomIds: Array<string>;
	readonly #creationTime: string;

	public constructor(data: any)
	{
		SealedClassError.throwIfNotEqual(RoomData, new.target);
		ThrowHelper.TypeError.throwIfNotType(data, "object");
		ThrowHelper.TypeError.throwIfNotType(data.id, "string");
		ThrowHelper.TypeError.throwIfNotType(data.name, "string");
		ThrowHelper.TypeError.throwIfNotType(data.description, "string");
		ThrowHelper.TypeError.throwIfNotType(data.isEntrance, "boolean");
		ThrowHelper.TypeError.throwIfNotType(data.connectedRoomIds, Array<string>);
		for (const id of data.connectedRoomIds)
		{
			ThrowHelper.TypeError.throwIfNotType(id, "string")
		}
		ThrowHelper.TypeError.throwIfNotType(data.creationTime, "string");

		this.#id = data.id;
		this.#name = data.name;
		this.#description = data.description;
		this.#isEntrance = data.isEntrance;
		this.#connectedRoomIds = Object.freeze([...data.connectedRoomIds]);
		this.#creationTime = data.creationTime;
	}

	public get id()
	{
		return this.#id;
	}

	public get name()
	{
		return this.#name;
	}

	public get description()
	{
		return this.#description;
	}

	public get isEntrance()
	{
		return this.#isEntrance;
	}

	public get connectedRoomIds(): ReadonlyArray<string>
	{
		return this.#connectedRoomIds;
	}

	public get creationTime()
	{
		return this.#creationTime;
	}
}
