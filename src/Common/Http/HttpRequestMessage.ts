import {HttpMethod} from "./HttpMethod.js";
import {HttpContent} from "./HttpContent.js";
import {ThrowHelper} from "../ThrowHelper.js";
import {HeaderMap} from "./HeaderMap.js";

export class HttpRequestMessage
{
	readonly #method: HttpMethod;
	readonly #requestUri: URL | string;
	readonly #headers: HeaderMap;
	#content: HttpContent | null;

	public constructor(method: HttpMethod, requestUri: URL | string)
	{
		ThrowHelper.TypeError.throwIfNotType(method, "number");
		ThrowHelper.TypeError.throwIfNotAnyType(requestUri, [URL, "string"]);

		this.#method = method;
		this.#requestUri = requestUri;
		this.#headers = new HeaderMap();
		this.#content = null;
	}

	public get method()
	{
		return this.#method;
	}

	public get requestUri()
	{
		return this.#requestUri;
	}

	public get headers()
	{
		return this.#headers;
	}

	public get content()
	{
		return this.#content;
	}

	public set content(value: HttpContent | null)
	{
		ThrowHelper.TypeError.throwIfNotNullAndType(value, HttpContent);
		this.#content = value;
	}
}
