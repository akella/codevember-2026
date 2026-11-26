import { simulate } from "./tear";

self.onmessage = ({ data }) => {
  const t = simulate(data.shape, data.options);
  (self as unknown as Worker).postMessage(t, [t.places.buffer, t.body.buffer, t.end.buffer, t.length.buffer, t.snaps.buffer] as Transferable[]);
};
