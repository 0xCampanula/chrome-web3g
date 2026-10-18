import { web3Url } from './../web3-url';
const he = require('he');
const Base64 = require('js-base64');

const chromeExtensionPrefix = chrome.runtime.getURL('/');
const web3UrlScheme = 'web3://';
const web3ScriptUrlScheme = 'web3scripturl://';
const web3ScriptInlineScheme = 'web3scriptinline://';
const web3ScriptInitScheme = 'web3scriptinit://';
const web3StylesheetScheme = 'web3stylesheet://';
const web3FaviconScheme = 'web3favicon://';
const htmlTagRegex = /<html(?:\s[^>]*)?>/i;
const headTagRegex = /<head(?:\s[^>]*)?>/i;
const baseTagRegexGlobal = /<base(?:\s[^>]*)?>/gi;
const linkTagRegexGlobal = /<link(|\s[^>]*)>/gi;
const scriptTagRegexGlobal = /<script((?:\s[^>]*)?)>((?:(?!<\/script).)*?)<\/script\s*>/sgi;
const attributeTokenRegexGlobal = /([-_\w\.]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>=]+)))?/g;
const cssCommentsRegexGlobal = /\/\*.*?\*\//sgi;
const cssRuleRegex = /^[-_\.#"'\[\]\w]+\s*(?:,\s*[-_\.#"'\[\]\w]+\s*)*\{/i;
const cssAtRuleRegex = /^@(?:-|font|charset|keyframes|media)\b/i;

// Parses an HTML attribute string into [name, value] pairs.
// Handles double-quoted, single-quoted, unquoted, and naked attributes,
// including quoted values that contain whitespace.
// A naked attribute (no '=') yields a null value.
function parseAttributes(attrString: string): Array<[string, string | null]> {
	const attrs: Array<[string, string | null]> = [];
	attributeTokenRegexGlobal.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = attributeTokenRegexGlobal.exec(attrString)) !== null) {
		const name = m[1];
		const value = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : null));
		attrs.push([name, value]);
	}
	return attrs;
}

// Renders an attribute back to its HTML form.
function renderAttribute(name: string, value: string | null): string {
	if (value === null) {
		return name;
	}
	return name + '="' + he.encode(value) + '"';
}

export class htmlProcessor {
	readonly url: web3Url;
	foundFavicon: boolean;

	constructor(url: web3Url) {
		this.url = url;
		this.foundFavicon = false;
	}

	// Processes a <script> tag match result.
	// Used during HTML processing.
	protected processHTMLScriptTag = (match: string, scriptAttributes: string, body: string): string => {
		let result = ['<script'];
		let scriptSrc: string | null = null;
		for (const [name, value] of parseAttributes(scriptAttributes)) {
			if (name == 'src') {
				// A naked or empty src is treated as an inline script.
				scriptSrc = value === null ? '' : value;
				continue;
			}
			result.push(renderAttribute(name, value));
		}
		if (scriptSrc !== null && scriptSrc != '') {
			result.push('src="' + chromeExtensionPrefix + web3ScriptUrlScheme + Base64.encode(this.url.maybeHttp(scriptSrc)) + '"');
		} else {
			result.push('src="' + chromeExtensionPrefix + web3ScriptInlineScheme + Base64.encode(body.trim()) + '"');
		}
		result.push('></script>');
		return result.join(' ');
	}

	// Processes a <link> tag match result.
	// Used during HTML processing.
	protected processHTMLLinkTag = (match: string, linkAttributes: string): string => {
		let result = ['<link'];
		let linkRel: string | null = null;
		let linkAs = '';
		let linkHref: string | null = null;
		for (const [name, value] of parseAttributes(linkAttributes)) {
			if (name == 'rel') {
				linkRel = value === null ? '' : value;
				continue;
			}
			if (name == 'as') {
				linkAs = value === null ? '' : value;
				continue;
			}
			if (name == 'href') {
				linkHref = value === null ? '' : value;
				continue;
			}
			result.push(renderAttribute(name, value));
		}
		if (linkRel == 'prefetch' && linkAs == 'script') {
			result.push('rel="prefetch"');
			result.push('as="script"');
			result.push('href="' + chromeExtensionPrefix + web3ScriptUrlScheme + Base64.encode(this.url.maybeHttp(linkHref === null ? '' : linkHref)) + '"');
			result.push('/>');
			return result.join(' ');
		}
		if (linkRel != 'stylesheet' && linkRel != 'icon') {
			return '';
		}
		if (linkRel == 'icon') {
			this.foundFavicon = true;
		}
		result.push('rel="' + linkRel + '"');
		if (linkAs != '') {
			result.push('as="' + he.encode(linkAs) + '"');
		}
		let linkUrl = this.url.maybeHttp(linkHref === null ? '' : linkHref);
		if (linkUrl.startsWith(web3UrlScheme)) {
			if (linkRel == 'stylesheet') {
				linkUrl = chromeExtensionPrefix + web3StylesheetScheme + (new web3Url(linkUrl)).toString().substr(web3UrlScheme.length);
			} else {
				linkUrl = chromeExtensionPrefix + linkUrl
			}
		}
		result.push('href="' + he.encode(linkUrl) + '"');
		result.push('/>');
		return result.join(' ');
	}

	protected baseTag = (): string => {
		return '<base href="' + he.encode(this.url.getRoot().toRewritable()) + '" />';
	}

	protected initJavaScriptTag = (): string => {
		return '<script src="' + chromeExtensionPrefix + web3ScriptInitScheme + Base64.encode(this.url.toString()) + '"></script>';
	}

	protected faviconTag = (): string => {
		if (this.foundFavicon) {
			return '';
		}
		return '<link rel="icon" href="' + chromeExtensionPrefix + web3FaviconScheme + he.encode(this.url.getRoot().toString()) + '" />';
	}

	// Rewrites HTML code to work in a chrome-extension context.
	processHtml = (code: string): string => {
		code = code.replaceAll(baseTagRegexGlobal, '');
		code = code.replaceAll(linkTagRegexGlobal, this.processHTMLLinkTag);
		code = code.replaceAll(scriptTagRegexGlobal, this.processHTMLScriptTag);
		const injectedTags = this.baseTag() + this.initJavaScriptTag() + this.faviconTag();
		const headMatch = code.match(headTagRegex);
		if (headMatch) {
			let insertIndex = headMatch.index + headMatch[0].length;
			code = code.substring(0, insertIndex) + injectedTags + code.substring(insertIndex);
		} else {
			const htmlMatch = code.match(htmlTagRegex);
			if (htmlMatch) {
				let insertIndex = htmlMatch.index + htmlMatch[0].length;
				code = code.substring(0, insertIndex) + injectedTags + code.substring(insertIndex);
			} else {
				code = '<html><head>' + injectedTags + '</head>' + code + '</html>';
			}
		}
		return code;
	}
}

// Returns whether the given string looks like HTML.
export function looksLikeHTML(code: string): boolean {
	const lowerCode = code.trimStart().toLowerCase();
	if (lowerCode.startsWith('<!doctype html')) {
		return true;
	}
	if (lowerCode.startsWith('<html')) {
		return true;
	}
	// Only scan the leading portion to avoid false positives on plain-text
	// or binary content that happens to contain the substring "<head".
	if (lowerCode.substring(0, 1024).indexOf('<head') != -1) {
		return true;
	}
	return false;
}

// Returns whether the given string looks like CSS.
export function looksLikeCSS(code: string): boolean {
	const noCommentsCode = code.toLowerCase().replaceAll(cssCommentsRegexGlobal, '').trimStart();
	if (noCommentsCode.match(cssRuleRegex) || noCommentsCode.match(cssAtRuleRegex)) {
		return true;
	}
	return false;
}
