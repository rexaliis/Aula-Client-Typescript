﻿import { HttpContent } from "./HttpContent.js";
import { ThrowHelper } from "../ThrowHelper.js";
import { HeaderMap } from "./HeaderMap.js";
import { SealedClassError } from "../SealedClassError.js";

/**
 * Provides HTTP content based on a stream.
 * */
export class StreamContent extends HttpContent
{
	readonly #_stream: ReadableStream<Uint8Array>;
	readonly #_headers: HeaderMap;

	/**
	 * Initializes a new instance of {@link StreamContent}.
	 * @param stream The underlying stream of content.
	 * @param contentType The media type of the content as defined in {@link https://www.rfc-editor.org/rfc/rfc6838 RFC 6836}.
	 * */
	public constructor(stream: ReadableStream<Uint8Array>, contentType = "application/octet-stream")
	{
		super();
		SealedClassError.throwIfNotEqual(StreamContent, new.target);
		ThrowHelper.TypeError.throwIfNotType(stream, ReadableStream<Uint8Array>);
		ThrowHelper.TypeError.throwIfNotType(contentType, "string");

		this.#_stream = stream;

		this.#_headers = new HeaderMap();
		this.#_headers.append("Content-Type", contentType);
	}

	public get headers()
	{
		return this.#_headers;
	}

	public readAsStream()
	{
		return this.#_stream;
	}

	public async readAsString()
	{
		const reader = this.#_stream.getReader();
		const decoder = new TextDecoder();

		let result = "";
		while (true)
		{
			const { done, value } = await reader.read();
			result += decoder.decode(value);

			if (done)
			{
				break;
			}
		}

		return result;
	}

	public dispose()
	{
	}
}
