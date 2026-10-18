// Returns whether development mode is enabled.
// Unpacked / locally built extensions have no update_url in their manifest;
// store-distributed builds always carry one.
export function developmentMode() {
	return !('update_url' in chrome.runtime.getManifest());
}
