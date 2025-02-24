import { EmptyContent } from "./EmptyContent.js";
import { HttpMessageHandler } from "./HttpMessageHandler.js";
import { HttpMethod } from "./HttpMethod.js";
import { HttpRequestMessage } from "./HttpRequestMessage.js";
import { HttpResponseMessage } from "./HttpResponseMessage.js";
import { HttpStatusCode } from "./HttpStatusCode.js";
import { StreamContent } from "./StreamContent.js";

export class HttpFetchHandler extends HttpMessageHandler
{
	public async Send(message: HttpRequestMessage): Promise<HttpResponseMessage>
	{
		const received = await fetch(message.requestUri,
			{
				method: HttpMethod[message.method],
				headers: Array.from(message.headers),
				body: message.content?.stream
			});

		const status = received.status as HttpStatusCode;
		const content = received.body ? new StreamContent(received.body) : EmptyContent.instance;
		const headers = new Map<string, string>(received.headers);
		return new HttpResponseMessage(status, content, headers);
	}
}
