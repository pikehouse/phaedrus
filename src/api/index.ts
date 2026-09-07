import type { SonosApi } from './types';
import { TauriSonosApi, isTauri } from './tauri';
import { MockSonosApi } from './mock';

/** Real speakers inside Tauri; a believable fake in a plain browser. */
export const api: SonosApi = isTauri() ? new TauriSonosApi() : new MockSonosApi();

export const usingMock = !isTauri();
export { isTauri };
