﻿import { RestClient } from "../RestClient.js";
import { BanData } from "./Models/BanData.js";
import { ThrowHelper } from "../../../Common/ThrowHelper.js";

/**
 * Represents a ban within Aula.
 * */
export abstract class Ban
{
	readonly #_restClient: RestClient;
	readonly #_data: BanData;
	#_creationDate: Date | null = null;

	/**
	 * Initializes a new instance of {@link Ban}.
	 * @param data A DTO containing the entity data.
	 * @param restClient The {@link RestClient} that is initializing this instance.
	 * */
	protected constructor(data: BanData, restClient: RestClient)
	{
		ThrowHelper.TypeError.throwIfNotType(data, BanData);
		ThrowHelper.TypeError.throwIfNotType(restClient, RestClient);

		this.#_restClient = restClient;
		this.#_data = data;
	}

	/**
	 * Gets the {@link RestClient} that initialized this instance.
	 * */
	get restClient()
	{
		return this.#_restClient;
	}

	/**
	 * Gets the type of ban
	 * */
	get type()
	{
		return this.#_data.type;
	}

	/**
	 * Gets the ID of the user that created the ban.
	 * */
	get executorId()
	{
		return this.#_data.executorId;
	}

	/**
	 * Gets the reason for the ban.
	 * */
	get reason()
	{
		return this.#_data.reason;
	}

	/**
	 * Gets the emission date of the ban as a {@link Date} object.
	 * */
	get creationDate()
	{
		return this.#_creationDate ??= new Date(this.#_data.creationDate);
	}

	/**
	 * Gets the latest version of this entity, or null if it no longer exists.
	 * */
	public abstract getLatest(): Promise<Ban | null>;

	/**
	 * Gets the user that created the ban, or null if it no longer exists or the creator was not a user.
	 * */
	public async getExecutor()
	{
		if (this.executorId === null)
		{
			return null;
		}

		return await this.restClient.getUser(this.executorId);
	}
}
