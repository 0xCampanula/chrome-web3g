import { getConfig } from './config';

const chromeExtensionPrefix = chrome.runtime.getURL('/');
const chromeExtensionPrefixLength = chromeExtensionPrefix.length;
const web3Scheme = 'web3://';

// Represents a *.w3link.io gateway subdomain.
interface gatewayChain {
	// The subdomain of w3link.io.
	w3link: string;
	// The chain ID that this w3link.io gateway corresponds to.
	chainId: number;
}

// List of known *.w3link.io gateways.
const gatewayChains: gatewayChain[] = [
	{w3link: 'eth',             chainId: 1},
	{w3link: 'oeth',            chainId: 10},
	{w3link: 'arb1',            chainId: 42161},
	{w3link: 'bnb',             chainId: 56},
	{w3link: 'avax',            chainId: 43114},
];

// List of all declarativeNetRequest rule resource types. Top-level
// navigations (MAIN_FRAME) are intentionally excluded: they are handled by
// the webNavigation listener, because Chrome blocks renderer-initiated
// redirects to extension pages.
const allDeclarativeNetRequestRuleResourceTypes: chrome.declarativeNetRequest.ResourceType[] = [
	chrome.declarativeNetRequest.ResourceType.SUB_FRAME,
	chrome.declarativeNetRequest.ResourceType.STYLESHEET,
	chrome.declarativeNetRequest.ResourceType.SCRIPT,
	chrome.declarativeNetRequest.ResourceType.IMAGE,
	chrome.declarativeNetRequest.ResourceType.FONT,
	chrome.declarativeNetRequest.ResourceType.OBJECT,
	chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
	chrome.declarativeNetRequest.ResourceType.PING,
	chrome.declarativeNetRequest.ResourceType.CSP_REPORT,
	chrome.declarativeNetRequest.ResourceType.MEDIA,
	chrome.declarativeNetRequest.ResourceType.WEBSOCKET,
	chrome.declarativeNetRequest.ResourceType.OTHER,
];

// Generate declarativeNetRequest redirect rules for redirecting requests
// to the extension service worker.
export function getDeclarativeNetRequestRules(): chrome.declarativeNetRequest.Rule[] {
	let rules: chrome.declarativeNetRequest.Rule[] = [
		// Internal *.web3 rewrite rule, variant with the chain ID encoded as an
		// extra subdomain label: https://name.<chainId>.web3/path
		// (higher priority than the plain variant below, which also matches).
		{
			'id': 1,
			'priority': 2,
			'action': {
				'type': chrome.declarativeNetRequest.RuleActionType.REDIRECT,
				'redirect': {
					'regexSubstitution': chromeExtensionPrefix + web3Scheme + '\\1' + ':' + '\\2' + '\\3',
				},
			},
			'condition': {
				'regexFilter': '^https?://([^/]+?)\\.(\\d+)\\.web3(|/.*)$',
				'resourceTypes': allDeclarativeNetRequestRuleResourceTypes,
			},
		},
		// Internal *.web3 rewrite rule, plain variant: https://name.web3/path
		{
			'id': 2,
			'priority': 1,
			'action': {
				'type': chrome.declarativeNetRequest.RuleActionType.REDIRECT,
				'redirect': {
					'regexSubstitution': chromeExtensionPrefix + web3Scheme + '\\1\\2',
				},
			},
			'condition': {
				'regexFilter': '^https?://([^/]+?)\\.web3(|/.*)$',
				'resourceTypes': allDeclarativeNetRequestRuleResourceTypes,
			},
		},
		// Special-case *.w3eth.io rewrite rule:
		{
			'id': 1000,
			'priority': 1,
			'action': {
				'type': chrome.declarativeNetRequest.RuleActionType.REDIRECT,
				'redirect': {
					'regexSubstitution': chromeExtensionPrefix + web3Scheme + '\\1.eth\\2',
				},
			},
			'condition': {
				'regexFilter': '^https?://([^/]+)\\.w3eth.io(|/.*)$',
				'resourceTypes': allDeclarativeNetRequestRuleResourceTypes,
			},
		},
	];
	// Start w3link rules at ID 1001.
	let ruleId = 1001;
	for (let gateway of gatewayChains) {
		let portPart = '';
		// web3:// URLs default to chain ID 1 when no explicit chain ID is
		// present; every other chain must be spelled out as web3://name:<id>.
		if (gateway.chainId != 1) {
			portPart = ':' + String(gateway.chainId);
		}
		rules.push({
			'id': ruleId,
			'priority': 1,
			'action': {
				'type': chrome.declarativeNetRequest.RuleActionType.REDIRECT,
				'redirect': {
					'regexSubstitution': chromeExtensionPrefix + web3Scheme + '\\1' + portPart + '\\2',
				},
			},
			'condition': {
				'regexFilter': '^https?://([^/]+)\\.' + gateway.w3link + '\\.w3link.io(|/.*)$',
				'resourceTypes': allDeclarativeNetRequestRuleResourceTypes,
			},
		});
		ruleId++;
	}
	// Generic w3link rule for chains spelled out as a numeric chain ID label:
	// https://name.<chainId>.w3link.io/path -> web3://name:<chainId>/path
	// (the named gateways above are all non-numeric, so there is no overlap).
	rules.push({
		'id': ruleId,
		'priority': 1,
		'action': {
			'type': chrome.declarativeNetRequest.RuleActionType.REDIRECT,
			'redirect': {
				'regexSubstitution': chromeExtensionPrefix + web3Scheme + '\\1' + ':' + '\\2' + '\\3',
			},
		},
		'condition': {
			'regexFilter': '^https?://([^/]+)\\.(\\d+)\\.w3link\\.io(|/.*)$',
			'resourceTypes': allDeclarativeNetRequestRuleResourceTypes,
		},
	});
	return rules;
}

// Convert an https URL on a web3 gateway domain (*.web3, *.w3eth.io,
// *.w3link.io) to the equivalent internal extension page URL, or null when
// the URL does not match any known gateway format. Mirrors the redirect
// rules below; used for top-level navigations, which cannot be redirected
// to extension pages by declarativeNetRequest (Chrome blocks
// renderer-initiated navigations to chrome-extension:// URLs with
// ERR_BLOCKED_BY_CLIENT).
export async function convertWeb3HttpsUrl(url: string): Promise<string | null> {
	let match = url.match(/^https?:\/\/([^\/]+?)\.(\d+)\.web3(\/.*)?$/i);
	if (match) {
		return chromeExtensionPrefix + web3Scheme + match[1] + ':' + match[2] + (match[3] ?? '/');
	}
	match = url.match(/^https?:\/\/([^\/]+?)\.web3(\/.*)?$/i);
	if (match) {
		return chromeExtensionPrefix + web3Scheme + match[1] + (match[2] ?? '/');
	}
	match = url.match(/^https?:\/\/([^\/]+)\.w3eth\.io(\/.*)?$/i);
	if (match) {
		return chromeExtensionPrefix + web3Scheme + match[1] + '.eth' + (match[2] ?? '/');
	}
	for (let gateway of gatewayChains) {
		match = url.match('^https?://([^/]+)\\.' + gateway.w3link + '\\.w3link\\.io(/.*)?$');
		if (match) {
			const portPart = gateway.chainId == 1 ? '' : ':' + String(gateway.chainId);
			return chromeExtensionPrefix + web3Scheme + match[1] + portPart + (match[2] ?? '/');
		}
	}
	// Generic numeric chain ID label: name.<chainId>.w3link.io
	match = url.match(/^https?:\/\/([^\/]+)\.(\d+)\.w3link\.io(\/.*)?$/i);
	if (match) {
		return chromeExtensionPrefix + web3Scheme + match[1] + ':' + match[2] + (match[3] ?? '/');
	}
	// Generic chain short name label: name.<shortName>.w3link.io. Short names
	// come from the configured chain list (web3gprotocol chainlist plus any
	// user-defined custom chains), e.g. name.sep.w3link.io -> chain 11155111.
	match = url.match(/^https?:\/\/([^\/]+)\.([a-z0-9-]+)\.w3link\.io(\/.*)?$/i);
	if (match) {
		const config = await getConfig();
		for (let chainConfig of await config.getChainConfigs()) {
			if ((chainConfig.ShortName ?? '').toLowerCase() === match[2].toLowerCase()) {
				const portPart = chainConfig.ChainID == 1 ? '' : ':' + String(chainConfig.ChainID);
				return chromeExtensionPrefix + web3Scheme + match[1] + portPart + (match[3] ?? '/');
			}
		}
	}
	return null;
}

// Get the IDs of declarativeNetRequest rules.
// This function should return all the IDs used by any declarativeNetRequest rules
// that any version of this extension ever used.
export function getAllPastDeclarativeNetRequestRuleIds(): number[] {
	let ruleIds = [];
	for (let rule of getDeclarativeNetRequestRules()) {
		ruleIds.push(rule.id);
	}
	return ruleIds;
}
