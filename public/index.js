const adapter = require('webrtc-adapter')
const Janus = require('./janus.js')

window['adapter'] = adapter.default

var server = "wss://" + window.location.hostname + ":8989/janus"
const myroom = Number(window.location.pathname.split('/')[2])
console.log(myroom)
var opaqueId = "videoroomtest-" + Janus.randomString(12)
var username = Janus.randomString(12)

var janus = null
var sfutest = null
var mypvtid = null;

var localTracks = {}, localVideos = 0;
var feeds = [], feedStreams = {};

function publishOwnFeed(useAudio) {
	// Publish our stream

	// We want sendonly audio and video (uncomment the data track
	// too if you want to publish via datachannels as well)
	let tracks = [];
	if (useAudio)
		tracks.push({ type: 'audio', capture: true, recv: false });
	tracks.push({ type: 'video', capture: { width: 1920, height: 1080 }, recv: false, simulcast: false });
	//~ tracks.push({ type: 'data' });

	sfutest.createOffer(
		{
			tracks: tracks,
			customizeSdp: function(jsep) {
			},
			success: function(jsep) {
				Janus.debug("Got publisher SDP!", jsep);
				var publish = { request: "configure", audio: useAudio, video: true };
				sfutest.send({ message: publish, jsep: jsep });
			},
			error: function(error) {
				Janus.error("WebRTC error:", error);
				if (useAudio) {
					 publishOwnFeed(false);
				} else {
				}
			}
		});
}

function newRemoteFeed(id, display, streams) {
	// A new feed has been published, create a new plugin handle and attach to it as a subscriber
	var remoteFeed = null;
	if (!streams)
		streams = feedStreams[id];
	janus.attach(
		{
			plugin: "janus.plugin.videoroom",
			opaqueId: opaqueId,
			success: function(pluginHandle) {
				remoteFeed = pluginHandle;
				remoteFeed.remoteTracks = {};
				remoteFeed.remoteVideos = 0;
				remoteFeed.simulcastStarted = false;
				Janus.log("Plugin attached! (" + remoteFeed.getPlugin() + ", id=" + remoteFeed.getId() + ")");
				Janus.log("  -- This is a subscriber");
				// Prepare the streams to subscribe to, as an array: we have the list of
				// streams the feed is publishing, so we can choose what to pick or skip
				var subscription = [];
				for (var i in streams) {
					var stream = streams[i];
					// If the publisher is VP8/VP9 and this is an older Safari, let's avoid video
					if (stream.type === "video" && Janus.webRTCAdapter.browserDetails.browser === "safari" &&
							(stream.codec === "vp9" || (stream.codec === "vp8" && !Janus.safariVp8))) {
						//toastr.warning("Publisher is using " + stream.codec.toUpperCase +
						//	", but Safari doesn't support it: disabling video stream #" + stream.mindex);
						continue;
					}
					subscription.push({
						feed: stream.id,	// This is mandatory
						mid: stream.mid		// This is optional (all streams, if missing)
					});
					// FIXME Right now, this is always the same feed: in the future, it won't
					remoteFeed.rfid = stream.id;
					remoteFeed.rfdisplay = stream.display;
				}
				// We wait for the plugin to send us an offer
				var subscribe = {
					request: "join",
					room: myroom,
					ptype: "subscriber",
					streams: subscription,
					use_msid: false,
					private_id: mypvtid
				};
				remoteFeed.send({ message: subscribe });
			},
			error: function(error) {
				Janus.error("  -- Error attaching plugin...", error);
			},
			iceState: function(state) {
				Janus.log("ICE state (feed #" + remoteFeed.rfindex + ") changed to " + state);
			},
			webrtcState: function(on) {
				Janus.log("Janus says this WebRTC PeerConnection (feed #" + remoteFeed.rfindex + ") is " + (on ? "up" : "down") + " now");
			},
			slowLink: function(uplink, lost, mid) {
				Janus.warn("Janus reports problems " + (uplink ? "sending" : "receiving") +
					" packets on mid " + mid + " (" + lost + " lost packets)");
			},
			onmessage: function(msg, jsep) {
				Janus.debug(" ::: Got a message (subscriber) :::", msg);
				var event = msg["videoroom"];
				Janus.debug("Event: " + event);
				if (msg["error"]) {
				} else if (event) {
					if (event === "attached") {
						// Subscriber created and attached
						for (var i = 1; i < 6; i++) {
							if (!feeds[i]) {
								feeds[i] = remoteFeed;
								remoteFeed.rfindex = i;
								break;
							}
						}
						Janus.log("Successfully attached to feed in room " + msg["room"]);
					} else if (event === "event") {
						// Check if we got a simulcast-related event from this publisher
						var substream = msg["substream"];
						var temporal = msg["temporal"];
						if ((substream !== null && substream !== undefined) || (temporal !== null && temporal !== undefined)) {
							if (!remoteFeed.simulcastStarted) {
								remoteFeed.simulcastStarted = true;
								// Add some new buttons
								//addSimulcastButtons(remoteFeed.rfindex, true);
							}
							// We just received notice that there's been a switch, update the buttons
							//updateSimulcastButtons(remoteFeed.rfindex, substream, temporal);
						}
					} else {
						// What has just happened?
						// i dunno?
					}
				}
				if (jsep) {
					Janus.debug("Handling SDP as well...", jsep);
					var stereo = (jsep.sdp.indexOf("stereo=1") !== -1);
					// Answer and attach
					remoteFeed.createAnswer(
						{
							jsep: jsep,
							// We only specify data channels here, as this way in
							// case they were offered we'll enable them. Since we
							// don't mention audio or video tracks, we autoaccept them
							// as recvonly (since we won't capture anything ourselves)
							tracks: [
								{ type: 'data' }
							],
							customizeSdp: function(jsep) {
								if(stereo && jsep.sdp.indexOf("stereo=1") == -1) {
									// Make sure that our offer contains stereo too
									jsep.sdp = jsep.sdp.replace("useinbandfec=1", "useinbandfec=1;stereo=1");
								}
							},
							success: function(jsep) {
								Janus.debug("Got SDP!", jsep);
								var body = { request: "start", room: myroom };
								remoteFeed.send({ message: body, jsep: jsep });
							},
							error: function(error) {
								Janus.error("WebRTC error:", error);
							}
						});
				}
			},
			onlocaltrack: function(track, on) {
				// The subscriber stream is recvonly, we don't expect anything here
			},
			onremotetrack: function(track, mid, on) {
				Janus.debug("Remote feed #" + remoteFeed.rfindex + ", remote track (mid=" + mid + ") " + (on ? "added" : "removed") + ":", track);
				if (!on) {
					// Track removed, get rid of the stream and the rendering
					if (track.kind === "video") {
						remoteFeed.remoteVideos--;
						if (remoteFeed.remoteVideos === 0) {
							// No video, at least for now: show a placeholder
						}
					}
					delete remoteFeed.remoteTracks[mid];
					return;
				}
				const elemName = `td-${remoteFeed.rfindex}`
				var elem = document.getElementById(elemName)
				if (!elem) {
					elem = document.createElement('div')
					elem.setAttribute('id', elemName)
					videoContainer.appendChild(elem)
				}

				if (track.kind === "audio") {
					// New audio track: create a stream out of it, and use a hidden <audio> element
					const audioElemName = `audio-${mid}`
					if (elem.querySelector(`#${audioElemName}`))
						return
					stream = new MediaStream([track]);
					remoteFeed.remoteTracks[mid] = stream;
					Janus.log("Created remote audio stream:", stream);
					// append audio element
					const audioElem = document.createElement('audio')
					audioElem.setAttribute('id', audioElemName)
					audioElem.setAttribute('autoplay', true)
					audioElem.srcObject = stream
					elem.appendChild(audioElem)
				} else {
					// New video track: create a stream out of it
					const videoElemName = `video-${mid}`
					if (elem.querySelector(`#${videoElemName}`))
						return
					remoteFeed.remoteVideos++;
					stream = new MediaStream([track]);
					remoteFeed.remoteTracks[mid] = stream;
					Janus.log("Created remote video stream:", stream);
					const videoElem = document.createElement('video')
					videoElem.setAttribute('id', videoElemName)
					videoElem.setAttribute('class', 'video')
					videoElem.setAttribute('autoplay', true)
					videoElem.srcObject = stream
					elem.appendChild(videoElem)
					elem.setAttribute('class', 'remoteVideo')
				}
				
			},
			oncleanup: function() {
				Janus.log(" ::: Got a cleanup notification (remote feed " + id + ") :::");
				remoteFeed.spinner = null;
				remoteFeed.simulcastStarted = false;
				remoteFeed.remoteTracks = {};
				remoteFeed.remoteVideos = 0;
				videoContainer.removeChild(document.getElementById(`td-${remoteFeed.rfindex}`))
			}
		});
}

Janus.init({debug: "all", callback: function() {
			janus = new Janus(
				{
					server: server,
					// Should the Janus API require authentication, you can specify either the API secret or user token here too
					//		token: "mytoken",
					//	or
					//		apisecret: "serversecret",
					success: function() {
						janus.attach(
							{
								plugin: "janus.plugin.videoroom",
								opaqueId: opaqueId,
								success: function(pluginHandle) {
									sfutest = pluginHandle;
									Janus.log("Plugin attached! (" + sfutest.getPlugin() + ", id=" + sfutest.getId() + ")")
									Janus.log("  -- This is a publisher/manager")

									var register = {
										request: "join",
										room: myroom,
										ptype: "publisher",
										display: username
									};
									sfutest.send({ message: register });
								},
								error: function(error) {
									Janus.error("  -- Error attaching plugin...", error);
								},
								consentDialog: function(on) {
									Janus.debug("Consent dialog should be " + (on ? "on" : "off") + " now");
								},
								iceState: function(state) {
									Janus.log("ICE state changed to " + state);
								},
								mediaState: function(medium, on, mid) {
									Janus.log("Janus " + (on ? "started" : "stopped") + " receiving our " + medium + " (mid=" + mid + ")");
								},
								webrtcState: function(on) {
									Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
								},
								slowLink: function(uplink, lost, mid) {
									Janus.warn("Janus reports problems " + (uplink ? "sending" : "receiving") +
										" packets on mid " + mid + " (" + lost + " lost packets)");
								},
								onmessage: function(msg, jsep) {
									Janus.debug(" ::: Got a message (publisher) :::", msg);
									var event = msg["videoroom"];
									Janus.debug("Event: " + event);
									if (event) {
										if (event === "joined") {
											// Publisher/manager created, negotiate WebRTC and attach to existing feeds, if any
											myid = msg["id"];
											mypvtid = msg["private_id"];
											Janus.log("Successfully joined room " + msg["room"] + " with ID " + myid);
											publishOwnFeed(true)
											// Any new feed to attach to?
											if (msg["publishers"]) {
												var list = msg["publishers"];
												Janus.debug("Got a list of available publishers/feeds:", list);
												for (var f in list) {
													if (list[f]["dummy"])
														continue;
													var id = list[f]["id"];
													var streams = list[f]["streams"];
													for (var i in streams) {
														var stream = streams[i];
														stream["id"] = id;
														stream["display"] = display;
													}
													feedStreams[id] = streams;
													Janus.debug("  >> [" + id + "] " + display + ":", streams);
													newRemoteFeed(id, display, streams);
												}
											}
										} else if (event === "destroyed") {
											// The room has been destroyed
											Janus.warn("The room has been destroyed!");
										} else if (event === "event") {
											// Any info on our streams or a new feed to attach to?
											if (msg["streams"]) {
												var streams = msg["streams"];
												for (var i in streams) {
													var stream = streams[i];
													stream["id"] = myid;
													stream["display"] = username;
												}
												feedStreams[myid] = streams;
											} else if (msg["publishers"]) {
												var list = msg["publishers"];
												Janus.debug("Got a list of available publishers/feeds:", list);
												for (var f in list) {
													if (list[f]["dummy"])
														continue;
													var id = list[f]["id"];
													var display = list[f]["display"];
													var streams = list[f]["streams"];
													for (var i in streams) {
														var stream = streams[i];
														stream["id"] = id;
														stream["display"] = display;
													}
													feedStreams[id] = streams;
													Janus.debug("  >> [" + id + "] " + display + ":", streams);
													newRemoteFeed(id, display, streams);
												}
											} else if (msg["leaving"]) {
												// One of the publishers has gone away?
												var leaving = msg["leaving"];
												Janus.log("Publisher left: " + leaving);
												var remoteFeed = null;
												for (var i = 1; i < 6; i++) {
													if (feeds[i] && feeds[i].rfid == leaving) {
														remoteFeed = feeds[i];
														break;
													}
												}
												if (remoteFeed) {
													Janus.debug("Feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") has left the room, detaching");
													feeds[remoteFeed.rfindex] = null;
													remoteFeed.detach();
												}
												delete feedStreams[leaving];
											} else if (msg["unpublished"]) {
												// One of the publishers has unpublished?
												var unpublished = msg["unpublished"];
												Janus.log("Publisher left: " + unpublished);
												if (unpublished === 'ok') {
													// That's us
													sfutest.hangup();
													return;
												}
												var remoteFeed = null;
												for (var i = 1; i < 6; i++) {
													if (feeds[i] && feeds[i].rfid == unpublished) {
														remoteFeed = feeds[i];
														break;
													}
												}
												if (remoteFeed) {
													Janus.debug("Feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") has left the room, detaching");
													feeds[remoteFeed.rfindex] = null;
													remoteFeed.detach();
												}
												delete feedStreams[unpublished];
											} else if (msg["error"]) {
												if (msg["error_code"] === 426) {
													// This is a "no such room" error: give a more meaningful description
													Janus.log("No existing room. Creating new one.");
													var create = {
														request: "create",
														room: myroom,
														permanent: false,
														description: "A test room",
														is_private: true,
														bitrate: 30000000,
														publishers: 50
													};
													sfutest.send({ message: create, success: function(result) {
														var event = result["videoroom"]
														Janus.debug("Event: " + event)
														if (event) {
															room = result["room"]
															var register = {
																request: "join",
																room: room,
																ptype: "publisher",
																display: username
															};
															sfutest.send({ message: register });
														}
													}});
												} else {
													Janus.log("Error: " + msg["error"])
												}
											}
										}
									}
									if (jsep) {
										Janus.debug("Handling SDP as well...", jsep);
										sfutest.handleRemoteJsep({ jsep: jsep });
									}
								},
								onlocaltrack: function(track, on) {
									Janus.debug("Local track " + (on ? "added" : "removed") + ":", track);
									// We use the track ID as name of the element, but it may contain invalid characters
									var trackId = track.id.replace(/[{}]/g, "");
									if (!on) {
										// Track removed, get rid of the stream and the rendering
										var stream = localTracks[trackId];
										if (stream) {
											try {
												var tracks = stream.getTracks();
												for (var i in tracks) {
													var mst = tracks[i];
													if (mst !== null && mst !== undefined)
														mst.stop();
												}
											} catch(e) {}
										}
										if (track.kind === "video") {
											localVideos--;
											if (localVideos === 0) {
												// No video, at least for now: show a placeholder
											}
										}
										delete localTracks[trackId];
										return;
									}

									// If we're here, a new track was added
									var stream = localTracks[trackId];
									if (stream) {
										// We've been here already
										return;
									}

									if (track.kind === "audio") {
										// We ignore local audio tracks, they'd generate echo anyway
										if (localVideos === 0) {
											// No video, at least for now: show a placeholder
										}
									} else {
										// New video track: create a stream out of it
										localVideos++;
										stream = new MediaStream([track]);
										localTracks[trackId] = stream;
										Janus.log("Created local stream:", stream);
										Janus.log(stream.getTracks());
										Janus.log(stream.getVideoTracks());
										localVideo.srcObject = stream
										//Janus.attachMediaStream($('#myvideo' + trackId).get(0), stream);
									}
									if (sfutest.webrtcStuff.pc.iceConnectionState !== "completed" &&
											sfutest.webrtcStuff.pc.iceConnectionState !== "connected") {
									}
								},
								onremotetrack: function(track, mid, on) {
									// The publisher stream is sendonly, we don't expect anything here
								},
								oncleanup: function() {
									Janus.log(" ::: Got a cleanup notification: we are unpublished now :::");
									delete feedStreams[myid];
									localTracks = {};
									localVideos = 0;
								}
							})
					}
				})
}})
