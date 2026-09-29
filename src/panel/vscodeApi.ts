declare function acquireVsCodeApi(): {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

let api: ReturnType<typeof acquireVsCodeApi> | undefined;

export function getVsCodeApi() {
  if (!api) {
    api = acquireVsCodeApi();
  }
  return api;
}
