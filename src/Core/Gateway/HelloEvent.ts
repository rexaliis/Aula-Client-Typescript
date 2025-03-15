﻿import { SealedClassError } from "../../Common/SealedClassError.js";
import { HelloOperationData } from "./Models/HelloOperationData.js";
import { ThrowHelper } from "../../Common/ThrowHelper.js";
import { GatewayClient } from "./GatewayClient.js";

export class HelloEvent
{
	readonly #_data: HelloOperationData;
	readonly #_gatewayClient: GatewayClient;

	public constructor(data: HelloOperationData, gatewayClient: GatewayClient)
	{
		SealedClassError.throwIfNotEqual(HelloEvent, new.target);
		ThrowHelper.TypeError.throwIfNotType(data, HelloOperationData);
		ThrowHelper.TypeError.throwIfNotType(gatewayClient, GatewayClient);

		this.#_data = data;
		this.#_gatewayClient = gatewayClient;
	}

	public get sessionId()
	{
		return this.#_data.sessionId;
	}

	public get gatewayClient()
	{
		return this.#_gatewayClient;
	}
}
