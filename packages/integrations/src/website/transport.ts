// HTTP transport of the website fetcher (task 09A, docs/decisions.md D-09A-02). One request per
// connection, made to the address the fetcher checked: the socket is opened to that IP
// directly (no DNS lookup here, no connection pool, no proxy from the environment), while the
// Host header, TLS SNI and the certificate check use the URL's host name.

import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as netConnect, isIP } from 'node:net';
import type { Duplex } from 'node:stream';
import { connect as tlsConnect } from 'node:tls';
import type { AddressFamily } from './address.js';

export interface DialTarget {
  /** The checked public address. */
  readonly address: string;
  readonly family: AddressFamily;
  readonly port: number;
  /** The URL's host (no brackets): TLS server name and certificate identity. */
  readonly hostname: string;
  readonly tls: boolean;
}

/** Opens the connection. Production uses directDial; tests replace it to reach a local fixture. */
export type Dial = (target: DialTarget) => Duplex;

/** A TCP (or TLS) connection to the checked address itself, never to a name. */
export const directDial: Dial = (target) => {
  if (!target.tls) {
    return netConnect({
      host: target.address,
      port: target.port,
      family: target.family,
    });
  }
  // The host is an IP address, so TLS needs no family or lookup.
  return tlsConnect({
    host: target.address,
    port: target.port,
    // SNI and the certificate check use the name; an IP literal has no SNI and is checked
    // against the certificate's IP addresses. Certificates are always verified.
    ...(isIP(target.hostname) === 0 ? { servername: target.hostname } : {}),
    ALPNProtocols: ['http/1.1'],
    rejectUnauthorized: true,
  });
};

export interface TransportRequest {
  readonly url: URL;
  readonly address: string;
  readonly family: AddressFamily;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly maxHeaderBytes: number;
}

export interface TransportResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  /** The body as sent (still compressed if Content-Encoding says so). */
  readonly body: AsyncIterable<Uint8Array>;
  /** Stops reading and closes the connection. */
  close(): void;
}

export interface WebsiteTransport {
  request(request: TransportRequest): Promise<TransportResponse>;
}

/** GET only, HTTP/1.1, redirects returned (never followed here), strict HTTP parser. */
export class NodeHttpTransport implements WebsiteTransport {
  private readonly dial: Dial;

  constructor(options: { readonly dial?: Dial } = {}) {
    this.dial = options.dial ?? directDial;
  }

  request(input: TransportRequest): Promise<TransportResponse> {
    const { url, address, family, signal } = input;
    const tls = url.protocol === 'https:';
    const port = url.port === '' ? (tls ? 443 : 80) : Number(url.port);
    const hostname = url.hostname.startsWith('[')
      ? url.hostname.slice(1, -1)
      : url.hostname;
    const dial = this.dial;
    return new Promise((resolve, reject) => {
      const request = (tls ? httpsRequest : httpRequest)(
        {
          method: 'GET',
          host: hostname,
          port,
          path: `${url.pathname}${url.search}`,
          headers: { ...input.headers, host: url.host },
          setHost: false,
          signal,
          maxHeaderSize: input.maxHeaderBytes,
          insecureHTTPParser: false,
          createConnection: () =>
            dial({ address, family, port, hostname, tls }),
        },
        (response) => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: response,
            close: () => {
              response.destroy();
            },
          });
        },
      );
      // Kept for the request's lifetime: a late error (an abort while the body is read) must
      // not go unhandled. After the response it reaches the body's reader instead.
      request.on('error', (error) => {
        reject(error);
      });
      request.end();
    });
  }
}
