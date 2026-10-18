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
	{w3link: 'metis-andromeda', chainId: 1088},
	{w3link: 'bnb',             chainId: 56},
	{w3link: 'avax',            chainId: 43114},
	{w3link: 'matic',           chainId: 137},
];

// List of all declarativeNetRequest rule resource types.
const allDeclarativeNetRequestRuleResourceTypes: chrome.declarativeNetRequest.ResourceType[] = [
	chrome.declarativeNetRequest.ResourceType.MAIN_FRAME,
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
	return rules;
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
