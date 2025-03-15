﻿import { SealedClassError } from "../../Common/SealedClassError.js";
import { EventEmitter } from "../../Common/Threading/EventEmitter.js";
import { Action } from "../../Common/Action.js";
import { HelloEvent } from "./HelloEvent.js";
import { RestClient } from "../Rest/RestClient.js";
import { ThrowHelper } from "../../Common/ThrowHelper.js";
import { ClientWebSocket } from "../../Common/WebSockets/ClientWebSocket.js";
import { IDisposable } from "../../Common/IDisposable.js";
import { ObjectDisposedError } from "../../Common/ObjectDisposedError.js";
import { WebSocketMessageType } from "../../Common/WebSockets/WebSocketMessageType.js";
import { UInt8Stream } from "../../Common/IO/UInt8Stream.js";
import { WebSocketReceiveResult } from "../../Common/WebSockets/WebSocketReceiveResult.js";
import { GatewayPayload } from "./Events/Models/GatewayPayload.js";
import { WebSocketCloseCode } from "../../Common/WebSockets/WebSocketCloseCode.js";
import { WebSocketState } from "../../Common/WebSockets/WebSocketState.js";
import { Channel } from "../../Common/Threading/Channels/Channel.js";
import { OperationType } from "./Events/Models/OperationType.js";
import { HelloOperationData } from "./Events/Models/HelloOperationData.js";
import { CommonClientWebSocket } from "./CommonClientWebSocket.js";
import { InvalidOperationError } from "../../Common/InvalidOperationError.js";
import { Intents } from "./Intents.js";
import { UpdatePresenceEvent } from "./UpdatePresenceEvent.js";
import { EventType } from "./Events/Models/EventType.js";
import { PromiseCompletionSource } from "../../Common/Threading/PromiseCompletionSource.js";
import { WebSocketError } from "../../Common/WebSockets/WebSocketError.js";
import { UnboundedChannel } from "../../Common/Threading/Channels/UnboundedChannel.js";
import { Ban } from "../Rest/Entities/Ban.js";
import { BanData } from "../Rest/Entities/Models/BanData.js";
import { MessageData } from "../Rest/Entities/Models/MessageData.js";
import { Message } from "../Rest/Entities/Message.js";
import { UserStartedTypingEvent } from "./UserStartedTypingEvent.js";
import { UserStoppedTypingEvent } from "./UserStoppedTypingEvent.js";
import { RoomConnectionCreatedEvent } from "./RoomConnectionCreatedEvent.js";
import { RoomConnectionRemovedEvent } from "./RoomConnectionRemovedEvent.js";
import { UserCurrentRoomUpdatedEvent } from "./UserCurrentRoomUpdatedEvent.js";
import { UserTypingEventData } from "./Events/Models/UserTypingEventData.js";
import { BanCreatedEvent } from "./BanCreatedEvent.js";
import { BanRemovedEvent } from "./BanRemovedEvent.js";
import { MessageCreatedEvent } from "./MessageCreatedEvent.js";
import { MessageRemovedEvent } from "./MessageRemovedEvent.js";
import { RoomCreatedEvent } from "./RoomCreatedEvent.js";
import { RoomUpdatedEvent } from "./RoomUpdatedEvent.js";
import { RoomRemovedEvent } from "./RoomRemovedEvent.js";
import { UserUpdatedEvent } from "./UserUpdatedEvent.js";
import { RoomConnectionEventData } from "./Events/Models/RoomConnectionEventData.js";
import { RoomData } from "../Rest/Entities/Models/RoomData.js";
import { Room } from "../Rest/Entities/Room.js";
import { UserCurrentRoomUpdatedEventData } from "./Events/Models/UserCurrentRoomUpdatedEventData.js";
import { UserData } from "../Rest/Entities/Models/UserData.js";
import { User } from "../Rest/Entities/User.js";

export class GatewayClient implements IDisposable
{
	static readonly #s_textDecoder: TextDecoder = new TextDecoder("utf8", { fatal: true });
	static readonly #s_textEncoder: TextEncoder = new TextEncoder();
	readonly #_restClient: RestClient;
	readonly #_webSocket: ClientWebSocket;
	readonly #_eventEmitter: EventEmitter<ReceivableEvents> = new EventEmitter();
	#_pendingPayloads: Channel<PayloadSendRequest> | null = null;
	#_disconnectPromiseSource: PromiseCompletionSource<void> | null = null;
	#_uri: URL | null = null;
	#_disposed: boolean = false;

	public constructor(options: {
		restClient?: RestClient,
		webSocketType?: new () => ClientWebSocket,
	} = {})
	{
		SealedClassError.throwIfNotEqual(GatewayClient, new.target);
		ThrowHelper.TypeError.throwIfNullable(options);
		ThrowHelper.TypeError.throwIfNotAnyType(options.restClient, RestClient, "undefined");
		ThrowHelper.TypeError.throwIfNotAnyType(options.webSocketType, "function", "undefined");

		this.#_restClient = options.restClient ?? new RestClient();
		this.#_webSocket = new (options.webSocketType ?? CommonClientWebSocket)();
	}

	public get rest()
	{
		ObjectDisposedError.throwIf(this.#_disposed);
		return this.#_restClient;
	}

	get #pendingPayloads()
	{
		if (this.#_pendingPayloads === null)
		{
			throw new InvalidOperationError("Pending payloads collection is null");
		}

		return this.#_pendingPayloads;
	}

	public setIntents(intents: Intents | 0)
	{
		ThrowHelper.TypeError.throwIfNotType(intents, "number");
		ObjectDisposedError.throwIf(this.#_disposed);

		if (this.#_webSocket.state !== WebSocketState.Closed)
		{
			throw new InvalidOperationError("Cannot set the gateway intents because the client is not disconnected");
		}

		this.#_webSocket.headers.delete("X-Intents");
		this.#_webSocket.headers.append("X-Intents", intents.toString());
		return this;
	}

	public setBaseUri(uri: URL)
	{
		ThrowHelper.TypeError.throwIfNotType(uri, URL);
		ObjectDisposedError.throwIf(this.#_disposed);

		if (this.#_webSocket.state !== WebSocketState.Closed)
		{
			throw new InvalidOperationError("Cannot set the base uri when the client is connected");
		}

		this.#_uri = new URL(`${uri.href}${uri.href.endsWith("/") ? "" : "/"}api/v1/gateway`);
		this.#_restClient.setBaseUri(uri);

		return this;
	}

	public setToken(token: string)
	{
		ThrowHelper.TypeError.throwIfNotType(token, "string");
		ObjectDisposedError.throwIf(this.#_disposed);

		if (this.#_webSocket.state !== WebSocketState.Closed)
		{
			throw new InvalidOperationError("Cannot set the authorization token because the client is not disconnected");
		}

		this.#_webSocket.headers.delete("Authorization");
		this.#_webSocket.headers.append("Authorization", `Bearer ${token}`);
		this.#_restClient.setToken(token);
		return this;
	}

	public async connect(sessionId?: string)
	{
		ThrowHelper.TypeError.throwIfNotAnyType(sessionId, "string", "undefined");
		ObjectDisposedError.throwIf(this.#_disposed);

		if (this.#_webSocket.state !== WebSocketState.Closed ||
		    this.#_disconnectPromiseSource !== null)
		{
			throw new InvalidOperationError("Client is connecting or already connected");
		}

		if (this.#_uri === null)
		{
			throw new InvalidOperationError("Client's base uri is not defined");
		}

		if (!this.#_webSocket.headers.has("X-Intents"))
		{
			throw new InvalidOperationError("Gateway intents are not defined");
		}

		this.#_webSocket.headers.delete("X-SessionId");
		if (sessionId !== undefined)
		{
			this.#_webSocket.headers.append("X-SessionId", sessionId);
		}

		await this.#_webSocket.connect(this.#_uri);

		if (sessionId !== undefined)
		{
			await this.#_eventEmitter.emit("SessionResumed");
		}

		this.#_disconnectPromiseSource = new PromiseCompletionSource<void>();

		const receiveTask = this.#runPayloadReceiving();
		const sendTask = this.#runPayloadSending();

		Promise.all([ receiveTask, sendTask ]).then(() =>
		{
			this.#_disconnectPromiseSource!.resolve();
			this.#_disconnectPromiseSource = null;
			this.#_eventEmitter.emit("ClientDisconnected");
		});
	}

	public async waitForDisconnect()
	{
		ObjectDisposedError.throwIf(this.#_disposed);
		if (this.#_disconnectPromiseSource === null)
		{
			throw new InvalidOperationError("Client is not connected");
		}

		await this.#_disconnectPromiseSource.promise;
	}

	async disconnect()
	{
		ObjectDisposedError.throwIf(this.#_disposed);
		if (this.#_webSocket.state !== WebSocketState.Open)
		{
			throw new InvalidOperationError("Client is not connected");
		}

		await this.#_webSocket.close(WebSocketCloseCode.NormalClosure);
	}

	public dispose()
	{
		if (this.#_disposed)
		{
			return;
		}

		this.#_eventEmitter.dispose();
		this.#_webSocket.dispose();

		this.#_disposed = true;
	}

	public on<TEvent extends keyof ReceivableEvents>(
		event: TEvent,
		listener: ReceivableEvents[TEvent])
	{
		ThrowHelper.TypeError.throwIfNullable(event);
		ThrowHelper.TypeError.throwIfNotType(listener, "function");
		ObjectDisposedError.throwIf(this.#_disposed);

		return this.#_eventEmitter.on(event, listener);
	}

	public remove<TEvent extends keyof ReceivableEvents>(
		event: TEvent,
		listener: ReceivableEvents[TEvent])
	{
		ThrowHelper.TypeError.throwIfNullable(event);
		ThrowHelper.TypeError.throwIfNotType(listener, "function");
		ObjectDisposedError.throwIf(this.#_disposed);

		return this.#_eventEmitter.remove(event, listener);
	}

	public async updatePresence(...args: ConstructorParameters<typeof UpdatePresenceEvent>)
	{
		ThrowHelper.TypeError.throwIfNotType(args, "iterable");
		ObjectDisposedError.throwIf(this.#_disposed);

		const payload = new GatewayPayload(
			{
				operation: OperationType.Dispatch,
				event: EventType[EventType.UpdatePresence],
				data: new UpdatePresenceEvent(...args),
			});
		const sendPromiseSource = new PromiseCompletionSource<void>();
		const sendRequest = new PayloadSendRequest(GatewayClient.#s_textEncoder.encode(JSON.stringify(payload)), sendPromiseSource);

		await this.#pendingPayloads.writer.waitToWrite();
		await this.#pendingPayloads.writer.write(sendRequest);
		await sendPromiseSource.promise;
	}

	async #emitEventFromPayload(payload: GatewayPayload)
	{
		ThrowHelper.TypeError.throwIfNotType(payload, GatewayPayload);

		switch (payload.operation)
		{
			case OperationType.Hello:
			{
				ThrowHelper.TypeError.throwIfNotType(payload.data, HelloOperationData);
				await this.#_eventEmitter.emit("Hello", new HelloEvent(payload.data, this));
				break;
			}
			case OperationType.Dispatch:
			{
				switch (payload.event)
				{
					case EventType[EventType.BanCreated]:
						ThrowHelper.TypeError.throwIfNotType(payload.data, BanData);
						await this.#_eventEmitter.emit(
							"BanCreated", new BanCreatedEvent(new Ban(payload.data, this.#_restClient), this));
						break;
					case EventType[EventType.BanRemoved]:
						ThrowHelper.TypeError.throwIfNotType(payload.data, BanData);
						await this.#_eventEmitter.emit(
							"BanRemoved", new BanRemovedEvent(new Ban(payload.data, this.#_restClient), this));
						break;
					case EventType[EventType.MessageCreated]:
						ThrowHelper.TypeError.throwIfNotType(payload.data, MessageData);
						await this.#_eventEmitter.emit(
							"MessageCreated", new MessageCreatedEvent(new Message(payload.data, this.#_restClient), this));
						break;
					case EventType[EventType.MessageRemoved]:
						ThrowHelper.TypeError.throwIfNotType(payload.data, MessageData);
						await this.#_eventEmitter.emit(
							"MessageRemoved", new MessageRemovedEvent(new Message(payload.data, this.#_restClient), this));
						break;
					case EventType[EventType.UserStartedTyping]:
						ThrowHelper.TypeError.throwIfNotType(payload.data, UserTypingEventData);
						await this.#_eventEmitter.emit(
							"UserStartedTyping", new UserStartedTypingEvent(payload.data, this));
						break;
					case EventType[EventType.UserStoppedTyping]:
						ThrowHelper.TypeError.throwIfNotType(payload.data, UserTypingEventData);
						await this.#_eventEmitter.emit(
							"UserStoppedTyping", new UserStoppedTypingEvent(payload.data, this));
						break;
					case EventType[EventType.RoomConnectionCreated]:
						ThrowHelper.TypeError.throwIfNotType(payload.data, RoomConnectionEventData);
						await this.#_eventEmitter.emit(
							"RoomConnectionCreated", new RoomConnectionCreatedEvent(payload.data, this));
						break;
					case EventType[EventType.RoomConnectionRemoved]:
						ThrowHelper.TypeError.throwIfNotType(payload.data, RoomConnectionEventData);
						await this.#_eventEmitter.emit(
							"RoomConnectionRemoved", new RoomConnectionRemovedEvent(payload.data, this));
						break;
					case EventType[EventType.RoomCreated]:
						ThrowHelper.TypeError.throwIfNotType(payload.data, RoomData);
						await this.#_eventEmitter.emit(
							"RoomCreated", new RoomCreatedEvent(new Room(payload.data, this.#_restClient), this));
						break;
					case EventType[EventType.RoomUpdated]:
						ThrowHelper.TypeError.throwIfNotType(payload.data, RoomData);
						await this.#_eventEmitter.emit(
							"RoomUpdated", new RoomUpdatedEvent(new Room(payload.data, this.#_restClient), this));
						break;
					case EventType[EventType.RoomRemoved]:
						ThrowHelper.TypeError.throwIfNotType(payload.data, RoomData);
						await this.#_eventEmitter.emit(
							"RoomRemoved", new RoomRemovedEvent(new Room(payload.data, this.#_restClient), this));
						break;
					case EventType[EventType.UserCurrentRoomUpdated]:
						ThrowHelper.TypeError.throwIfNotType(payload.data, UserCurrentRoomUpdatedEventData);
						await this.#_eventEmitter.emit(
							"UserCurrentRoomUpdated", new UserCurrentRoomUpdatedEvent(payload.data, this));
						break;
					case EventType[EventType.UserUpdated]:
						ThrowHelper.TypeError.throwIfNotType(payload.data, UserData);
						await this.#_eventEmitter.emit(
							"UserUpdated", new UserUpdatedEvent(new User(payload.data, this.#_restClient), this));
						break;
					default:
						break;
				}

				break;
			}
			default:
				break;
		}
	}

	async #runPayloadReceiving()
	{
		this.#throwIfWebSocketNotOpen();

		while (this.#_webSocket.state === WebSocketState.Open)
		{
			const payload = await this.#receivePayload();
			if (payload === null)
			{
				break;
			}

			this.#emitEventFromPayload(payload).then();
		}
	}

	async #receivePayload()
	{
		this.#throwIfWebSocketNotOpen();

		const buffer = new Uint8Array(new ArrayBuffer(1024));
		const messageBytes = new UInt8Stream(1024);
		const messageWriter = messageBytes.getWriter();

		let received: WebSocketReceiveResult;
		do
		{
			try
			{
				received = await this.#_webSocket.receive(buffer);
			}
			catch (error)
			{
				if (!(error instanceof WebSocketError))
				{
					throw error;
				}

				this.#pendingPayloads.writer.complete();
				await messageWriter.close();
				await this.#_webSocket.close(WebSocketCloseCode.NormalClosure);
				return null;
			}

			if (received.messageType === WebSocketMessageType.Close)
			{
				this.#pendingPayloads.writer.complete();
				await messageWriter.close();
				await this.#_webSocket.close(WebSocketCloseCode.NormalClosure);
				return null;
			}
			else if (received.messageType === WebSocketMessageType.Binary)
			{
				this.#pendingPayloads.writer.complete();
				await messageWriter.close();
				await this.#_webSocket.close(WebSocketCloseCode.UnsupportedData);
				return null;
			}

			await messageWriter.write(new Uint8Array(buffer.buffer, 0, received.count));
		} while (!received.endOfMessage);

		await messageWriter.close();

		try
		{
			const messageText = GatewayClient.#s_textDecoder.decode(messageBytes.written);
			return new GatewayPayload(JSON.parse(messageText));
		}
		catch (error)
		{
			if (!(error instanceof TypeError) && !(error instanceof SyntaxError))
			{
				this.#pendingPayloads.writer.complete();
				await this.#_webSocket.close(WebSocketCloseCode.InternalError);
				throw error;
			}

			this.#pendingPayloads.writer.complete();
			await this.#_webSocket.close(WebSocketCloseCode.InvalidPayloadData);
		}

		return null;
	}

	async #runPayloadSending()
	{
		this.#throwIfWebSocketNotOpen();

		this.#_pendingPayloads = new UnboundedChannel();

		while (this.#_webSocket.state === WebSocketState.Open)
		{
			await this.#sendNextPayload();
		}
	}

	async #sendNextPayload()
	{
		if (!await this.#pendingPayloads.reader.waitToRead() ||
		    this.#_webSocket.state !== WebSocketState.Open)
		{
			return;
		}

		const payloadRequest = await this.#pendingPayloads.reader.read();
		await this.#_webSocket.send(payloadRequest.payloadBytes, WebSocketMessageType.Text, true);
		payloadRequest.requestPromiseSource.resolve();
	}

	#throwIfWebSocketNotOpen()
	{
		if (this.#_webSocket.state !== WebSocketState.Open)
		{
			throw new InvalidOperationError("WebSocket must be open");
		}
	}
}

class PayloadSendRequest
{
	readonly #_payloadBytes: Uint8Array;
	readonly #_requestPromiseSource: PromiseCompletionSource<void>;

	public constructor(payloadBytes: Uint8Array, requestPromiseSource: PromiseCompletionSource<void>)
	{
		SealedClassError.throwIfNotEqual(PayloadSendRequest, new.target);
		ThrowHelper.TypeError.throwIfNotType(payloadBytes, Uint8Array);
		ThrowHelper.TypeError.throwIfNotType(requestPromiseSource, PromiseCompletionSource);

		this.#_payloadBytes = payloadBytes;
		this.#_requestPromiseSource = requestPromiseSource;
	}

	public get payloadBytes()
	{
		return this.#_payloadBytes;
	}

	public get requestPromiseSource()
	{
		return this.#_requestPromiseSource;
	}
}

export interface ReceivableEvents
{
	Hello: Action<[ HelloEvent ]>;
	ClientDisconnected: Action<[]>;
	SessionResumed: Action<[]>;
	BanCreated: Action<[ BanCreatedEvent ]>;
	BanRemoved: Action<[ BanRemovedEvent ]>;
	MessageCreated: Action<[ MessageCreatedEvent ]>;
	MessageRemoved: Action<[ MessageRemovedEvent ]>;
	UserStartedTyping: Action<[ UserStartedTypingEvent ]>;
	UserStoppedTyping: Action<[ UserStoppedTypingEvent ]>;
	RoomConnectionCreated: Action<[ RoomConnectionCreatedEvent ]>;
	RoomConnectionRemoved: Action<[ RoomConnectionRemovedEvent ]>;
	RoomCreated: Action<[ RoomCreatedEvent ]>;
	RoomUpdated: Action<[ RoomUpdatedEvent ]>;
	RoomRemoved: Action<[ RoomRemovedEvent ]>;
	UserUpdated: Action<[ UserUpdatedEvent ]>;
	UserCurrentRoomUpdated: Action<[ UserCurrentRoomUpdatedEvent ]>;
}
