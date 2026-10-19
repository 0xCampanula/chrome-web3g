// Status line for the web3 media player page. Shows whether the media
// stream is progressing, stalled, blocked by the autoplay policy, or
// errored -- without opening devtools. This must live in a bundled file:
// extension pages enforce CSP script-src 'self', so inline scripts on the
// player page would never run.
(function () {
	const statusLine = document.getElementById('w3st');
	const media = document.querySelector('video,audio');
	if (statusLine == null || media == null) {
		return;
	}
	const status = () => {
		if (media.error) {
			return 'ERROR ' + media.error.code + ' ' + (media.error.message || '');
		}
		const buffers = [];
		for (let i = 0; i < media.buffered.length; i++) {
			buffers.push(media.buffered.start(i).toFixed(1) + '-' + media.buffered.end(i).toFixed(1));
		}
		return 'ready=' + media.readyState + ' net=' + media.networkState
			+ ' dur=' + (isFinite(media.duration) ? media.duration.toFixed(1) : '?')
			+ ' t=' + media.currentTime.toFixed(1)
			+ ' buf=' + buffers.join(',');
	};
	['progress', 'loadedmetadata', 'canplay', 'stalled', 'waiting', 'error', 'emptied', 'abort', 'suspend', 'pause', 'play']
		.forEach((ev) => {
			media.addEventListener(ev, () => {
				statusLine.textContent = ev + ': ' + status();
			});
		});
	setInterval(() => {
		statusLine.textContent = status();
	}, 1000);
	media.play().catch((e) => {
		statusLine.textContent = 'autoplay blocked - click the play button (' + e.name + ')';
	});
})();
