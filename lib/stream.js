// Streams newline-delimited JSON events to the browser: {"t":"delta"}, {"t":"done"} or {"t":"error"}.
import { HttpError } from "./http.js";

export function ndjsonStream(run) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      try {
        await run(send);
      } catch (err) {
        if (!(err instanceof HttpError)) console.error(err);
        send({ t: "error", error: err.code || "server_error", message: err instanceof HttpError ? err.message : "Something went wrong on our side. Try again." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
