﻿import { DelegatingHandler } from "../../Common/Http/DelegatingHandler.js";
import { Temporal } from "@js-temporal/polyfill";
import { Semaphore } from "../../Common/Threading/Semaphore.js";
import { SealedClassError } from "../../Common/SealedClassError.js";
import { ThrowHelper } from "../../Common/ThrowHelper.js";
import { ValueOutOfRangeError } from "../../Common/ValueOutOfRangeError.js";
import { HttpMethod } from "../../Common/Http/HttpMethod.js";
import { HttpMessageHandler } from "../../Common/Http/HttpMessageHandler.js";
import { HttpRequestMessage } from "../../Common/Http/HttpRequestMessage.js";
import { Action } from "../../Common/Action.js";
import { EventEmitter } from "../../Common/Threading/EventEmitter.js";
import { Delay } from "../../Common/Threading/Delay.js";
import { HttpStatusCode } from "../../Common/Http/HttpStatusCode.js";
import { ObjectDisposedError } from "../../Common/ObjectDisposedError.js";
import Instant = Temporal.Instant;

export class AulaRouteRateLimiterHandler extends DelegatingHandler
{
	readonly #_eventEmitter: EventEmitter<AulaRouteRateLimiterHandlerEvents> = new EventEmitter();
	readonly #_allowConcurrentRequests: boolean;
	readonly #_routeSemaphores: Map<string, Semaphore> = new Map();
	readonly #_rateLimits: Map<string, RouteRateLimit> = new Map();
	#_disposed: boolean = false;

	public constructor(innerHandler: HttpMessageHandler, allowConcurrentRequests: boolean)
	{
		super(innerHandler);
		SealedClassError.throwIfNotEqual(AulaRouteRateLimiterHandler, new.target);
		ThrowHelper.TypeError.throwIfNotType(allowConcurrentRequests, "boolean");

		this.#_allowConcurrentRequests = allowConcurrentRequests;
	}

	public get allowConcurrentRequests()
	{
		ObjectDisposedError.throwIf(this.#_disposed);
		return this.#_allowConcurrentRequests;
	}

	public async send(message: HttpRequestMessage)
	{
		ThrowHelper.TypeError.throwIfNotType(message, HttpRequestMessage);
		ThrowHelper.TypeError.throwIfNotType(message.requestUri, URL);
		ObjectDisposedError.throwIf(this.#_disposed);

		const routeHash = this.#hashRoute(message.method, message.requestUri);

		let routeSemaphore = this.#_routeSemaphores.get(routeHash);
		if (!this.#_allowConcurrentRequests && routeSemaphore === undefined)
		{
			routeSemaphore = new Semaphore(1, 1);
			this.#_routeSemaphores.set(routeHash, routeSemaphore);
		}

		if (routeSemaphore !== undefined)
		{
			await routeSemaphore.waitOne();
		}

		while (true)
		{
			ObjectDisposedError.throwIf(this.#_disposed);

			const now = Temporal.Now.instant();

			let routeRateLimit = this.#_rateLimits.get(routeHash);
			if (routeRateLimit !== undefined &&
			    Instant.compare(routeRateLimit.resetInstant, now) < 1)
			{
				routeRateLimit = new RouteRateLimit(
					routeRateLimit.requestLimit,
					routeRateLimit.windowMilliseconds,
					routeRateLimit.requestLimit,
					now.add({ milliseconds: routeRateLimit.windowMilliseconds }));
				this.#_rateLimits.set(routeHash, routeRateLimit);
			}

			// When concurrent requests are allowed, the response headers may not be reliable;
			// therefore, we proactively track the rate limit and take action when approaching it.
			if (routeRateLimit !== undefined &&
			    routeRateLimit.remainingRequests < 1)
			{
				const eventEmission = this.#_eventEmitter.emit("RequestDeferred", new RequestDeferredEvent(message.requestUri, routeRateLimit.resetInstant));
				const delay = Delay(routeRateLimit.resetInstant.since(now).milliseconds);
				await Promise.all([ eventEmission, delay ]);
				continue;
			}

			const response = await super.send(message);

			const requestLimitHeaderValue = response.headers.get("X-RateLimit-Route-Limit");
			const windowMillisecondsHeaderValue = response.headers.get("X-RateLimit-Route-WindowMilliseconds");
			if (requestLimitHeaderValue === undefined ||
			    windowMillisecondsHeaderValue === undefined)
			{
				// Endpoint does not have rate limits.
				routeSemaphore?.release();
				return response;
			}

			const requestLimit = parseInt(requestLimitHeaderValue, 10);
			const windowMilliseconds = parseInt(windowMillisecondsHeaderValue, 10);
			if (routeRateLimit === undefined ||
			    (routeRateLimit.requestLimit !== requestLimit ||
			    routeRateLimit.windowMilliseconds !== windowMilliseconds))
			{
				// This is the first request, so the limits need to be synchronized,
				// or the global rate limits may have been updated on the server
				routeRateLimit = new RouteRateLimit(
					requestLimit,
					windowMilliseconds,
					requestLimit,
					now.add({ milliseconds: windowMilliseconds }));
				this.#_rateLimits.set(routeHash, routeRateLimit);
			}

			routeRateLimit = new RouteRateLimit(
				routeRateLimit.requestLimit,
				routeRateLimit.windowMilliseconds,
				routeRateLimit.remainingRequests - 1,
				routeRateLimit.resetInstant);
			this.#_rateLimits.set(routeHash, routeRateLimit);

			const isGlobalHeaderValue = response.headers.get("X-RateLimit-IsGlobal");
			const resetTimestampHeaderValue = response.headers.get("X-RateLimit-ResetsAt");
			if (isGlobalHeaderValue !== undefined &&
			    isGlobalHeaderValue === "false")
			{
				// No requests remain, or an unexpected HTTP 429 (Too Many Requests) status code was encountered.
				const resetInstant = resetTimestampHeaderValue
					? Instant.from(resetTimestampHeaderValue)
					: routeRateLimit.resetInstant;

				if (response.statusCode === HttpStatusCode.TooManyRequests)
				{
					const eventEmission = await this.#_eventEmitter.emit("RateLimited", new RateLimitedEvent(resetInstant));
					const delay = await Delay(routeRateLimit.resetInstant.since(now).milliseconds);
					await Promise.all([ eventEmission, delay ]);
					continue;
				}

				await this.#_eventEmitter.emit("RequestDeferred", new RequestDeferredEvent(message.requestUri, resetInstant));
			}

			routeSemaphore?.release();
			return response;
		}
	}

	public dispose()
	{
		if (this.#_disposed)
		{
			return;
		}

		this.#_eventEmitter.dispose();
		this.#_rateLimits.clear();

		for (const semaphore of this.#_routeSemaphores)
		{
			this.dispose();
		}

		this.#_routeSemaphores.clear();

		this.#_disposed = true;
	}

	#hashRoute(httpMethod: HttpMethod, uri: URL)
	{
		ThrowHelper.TypeError.throwIfNotType(httpMethod, HttpMethod);
		ThrowHelper.TypeError.throwIfNotType(uri, URL);

		return `${httpMethod}.${uri}`;
	}
}

class RouteRateLimit
{
	readonly #requestLimit: number;
	readonly #windowMilliseconds: number;
	readonly #remainingRequests: number;
	readonly #resetTimestamp: number;

	public constructor(
		requestLimit: number,
		windowMilliseconds: number,
		remainingRequests: number,
		resetTimestamp: number)
	{
		SealedClassError.throwIfNotEqual(RouteRateLimit, new.target);
		ThrowHelper.TypeError.throwIfNotType(requestLimit, "number");
		ThrowHelper.TypeError.throwIfNotType(windowMilliseconds, "number");
		ThrowHelper.TypeError.throwIfNotType(remainingRequests, "number");
		ThrowHelper.TypeError.throwIfNotType(resetTimestamp, "number");
		ValueOutOfRangeError.throwIfLessThan(requestLimit, 1);
		ValueOutOfRangeError.throwIfLessThan(remainingRequests, 0);
		ValueOutOfRangeError.throwIfLessThan(windowMilliseconds, 1);
		ValueOutOfRangeError.throwIfGreaterThan(remainingRequests, requestLimit);

		this.#requestLimit = requestLimit;
		this.#windowMilliseconds = windowMilliseconds;
		this.#remainingRequests = remainingRequests;
		this.#resetTimestamp = resetTimestamp;
	}

	public get requestLimit()
	{
		return this.#requestLimit;
	}

	public get windowMilliseconds()
	{
		return this.#windowMilliseconds;
	}

	public get remainingRequests()
	{
		return this.#remainingRequests;
	}

	public get resetTimestamp()
	{
		return this.#resetTimestamp;
	}
}

export interface AulaRouteRateLimiterHandlerEvents
{
	RequestDeferred: Action<[ RequestDeferredEvent ]>;
	RateLimited: Action<[ RateLimitedEvent ]>;
}

export class RequestDeferredEvent
{
	readonly #uri: URL;
	readonly #resetInstant: Instant;

	public constructor(uri: URL, resetInstant: Instant)
	{
		SealedClassError.throwIfNotEqual(RequestDeferredEvent, new.target);
		ThrowHelper.TypeError.throwIfNotType(uri, URL);
		ThrowHelper.TypeError.throwIfNotType(resetInstant, Instant);

		this.#uri = uri;
		this.#resetInstant = resetInstant;
	}

	public get uri()
	{
		return this.#uri;
	}

	public get resetInstant()
	{
		return this.#resetInstant;
	}
}

export class RateLimitedEvent
{
	readonly #_resetTimestamp: number;

	public constructor(resetTimestamp: number)
	{
		SealedClassError.throwIfNotEqual(RateLimitedEvent, new.target);
		ThrowHelper.TypeError.throwIfNotType(resetTimestamp, "number");

		this.#_resetTimestamp = resetTimestamp;
	}

	public get resetTimestamp()
	{
		return this.#_resetTimestamp;
	}
}
