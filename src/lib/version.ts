/**
 * The version the app was built from. It comes from package.json at build time
 * rather than from the Tauri API, so the browser build, the tests and the
 * packaged app all agree on the same string without an async lookup.
 */
export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";

/** "v0.2.0" for the places that print it next to the product name. */
export const VERSION_LABEL = `v${APP_VERSION}`;
