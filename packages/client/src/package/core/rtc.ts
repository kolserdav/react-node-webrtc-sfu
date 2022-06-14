import { RTCInterface, MessageType } from '../types/interfaces';
import { log } from '../utils/lib';
import { MEDIA_CONSTRAINTS } from '../utils/constants';
import WS from './ws';

class RTC implements RTCInterface {
  public peerConnections: RTCInterface['peerConnections'] = {};

  private ws: WS;

  public room: number | null = null;

  constructor({ ws }: { ws: WS }) {
    this.ws = ws;
  }

  public createRTC: RTCInterface['createRTC'] = ({ id }) => {
    this.peerConnections[id] = new RTCPeerConnection({
      iceServers:
        process.env.NODE_ENV === 'production'
          ? [
              {
                urls: ['stun:stun.l.google.com:19302'],
              },
            ]
          : [],
    });
    return this.peerConnections;
  };

  public handleIceCandidate: RTCInterface['handleIceCandidate'] = ({
    targetUserId: target,
    userId,
  }) => {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const core = this;
    const targetUserId = target !== this.ws.userId ? target : userId;
    this.peerConnections[targetUserId].onicecandidate = function handleICECandidateEvent(
      event: RTCPeerConnectionIceEvent
    ) {
      if (event.candidate) {
        log('info', 'Outgoing ICE candidate:', event.candidate.usernameFragment);
        core.ws.sendMessage({
          type: MessageType.CANDIDATE,
          id: targetUserId,
          token: '',
          data: {
            candidate: event.candidate,
            userId: core.ws.userId,
          },
        });
      }
    };
    this.peerConnections[targetUserId].oniceconnectionstatechange =
      function handleICEConnectionStateChangeEvent(event: Event) {
        log(
          'info',
          'ICE connection state changed to:',
          core.peerConnections[targetUserId].iceConnectionState
        );
        switch (core.peerConnections[targetUserId].iceConnectionState) {
          case 'closed':
          case 'failed':
          case 'disconnected':
            core.closeVideoCall({ targetUserId });
            break;
        }
      };
    this.peerConnections[targetUserId].onicegatheringstatechange =
      function handleICEGatheringStateChangeEvent(ev: Event) {
        log(
          'info',
          `*** ICE gathering state changed to: ${core.peerConnections[targetUserId].iceGatheringState}`
        );
      };
    this.peerConnections[targetUserId].onsignalingstatechange =
      function handleSignalingStateChangeEvent(ev: Event) {
        log(
          'info',
          `WebRTC signaling state changed to: ${core.peerConnections[targetUserId].signalingState}`
        );
        switch (core.peerConnections[targetUserId].signalingState) {
          case 'closed':
            core.closeVideoCall({ targetUserId });
            break;
        }
      };
    this.peerConnections[targetUserId].onnegotiationneeded =
      function handleNegotiationNeededEvent() {
        log('info', '---> Creating offer');
        core.peerConnections[targetUserId]
          .createOffer()
          .then((offer): 1 | void | PromiseLike<void> => {
            if (!core.peerConnections[targetUserId]) {
              log(
                'warn',
                'Can not set local description because peerConnection is',
                core.peerConnections[targetUserId]
              );
              return 1;
            }
            return core.peerConnections[targetUserId].setLocalDescription(offer).catch((err) => {
              log('error', 'Error create local description', err);
            });
          })
          .then(() => {
            const { localDescription } = core.peerConnections[targetUserId];
            if (localDescription) {
              log('info', '---> Sending offer to remote peer');
              core.ws.sendMessage({
                id: targetUserId,
                type: MessageType.OFFER,
                token: '',
                data: {
                  sdp: localDescription,
                  userId: core.ws.userId,
                },
              });
            }
          });
      };
    this.peerConnections[targetUserId].ontrack = (e) => {
      this.onAddTrack(e);
    };
  };

  public invite({ targetUserId, userId }: { targetUserId: number; userId: number }) {
    this.handleIceCandidate({ targetUserId, userId });
    navigator.mediaDevices
      .getUserMedia(MEDIA_CONSTRAINTS)
      .then((localStream) => {
        log('info', '-- Adding tracks to the RTCPeerConnection');
        localStream.getTracks().forEach((track) => {
          this.peerConnections[targetUserId].addTrack(track, localStream);
        });
      })
      .catch((err) => {
        log('error', 'Error get self user media', err);
      });
  }

  // eslint-disable-next-line class-methods-use-this
  public onAddTrack(e: RTCTrackEvent): void {
    /** */
  }

  /**
   * handleNewICECandidateMsg
   */
  public handleCandidateMessage: RTCInterface['handleCandidateMessage'] = (msg, cb) => {
    const {
      id,
      data: { candidate, userId },
    } = msg;
    const cand = new RTCIceCandidate(candidate);
    if (cand.candidate) {
      this.peerConnections[userId]
        .addIceCandidate(cand)
        .then(() => {
          log('info', 'Adding received ICE candidate:', cand.usernameFragment);
          if (cb) {
            cb(cand);
          }
        })
        .catch((e) => {
          log('error', 'Set candidate error', {
            error: e,
            cand,
          });
          if (cb) {
            cb(null);
          }
        });
    }
  };

  private getRoom() {
    this.room = parseInt(window.location.pathname.replace('/', '').replace(/\?.*$/, ''), 10);
    return this.room;
  }

  public handleOfferMessage: RTCInterface['handleOfferMessage'] = (msg, cb) => {
    const {
      id,
      data: { sdp, userId },
    } = msg;
    if (!sdp) {
      log('warn', 'Message offer error because sdp is:', sdp);
      cb(null);
      return;
    }
    this.room = this.getRoom();
    this.handleIceCandidate({
      targetUserId: id,
      userId,
    });
    const desc = new RTCSessionDescription(sdp);
    console.warn(1, sdp.sdp);
    this.peerConnections[userId]
      .setRemoteDescription(desc)
      .then(() => {
        log('info', 'Setting up the local media stream...');
        return navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS);
      })
      .then((stream) => {
        const localStream = stream;
        log('info', '-- Local video stream obtained');
        localStream.getTracks().forEach((track) => {
          this.peerConnections[userId].addTrack(track, localStream);
        });
      })
      .then(() => {
        log('info', '------> Creating answer');
        this.peerConnections[userId].createAnswer().then((answ) => {
          if (!answ || !this.peerConnections[userId]) {
            log('error', 'Failed set local description for answer.', {
              answ,
              peerConnection: this.peerConnections[userId],
            });
            cb(null);
            return;
          }
          log('info', '------> Setting local description after creating answer');
          this.peerConnections[userId]
            .setLocalDescription(answ)
            .catch((err) => {
              log('error', 'Error set local description for answer', err);
            })
            .then(() => {
              const { localDescription } = this.peerConnections[userId];
              if (localDescription) {
                log('info', 'Sending answer packet back to other peer');
                this.ws.sendMessage({
                  id: userId,
                  type: MessageType.ANSWER,
                  token: '',
                  data: {
                    sdp: localDescription,
                    userId: this.ws.userId,
                  },
                });
                cb(localDescription);
              } else {
                log('warn', 'Failed send answer because localDescription is', localDescription);
              }
            });
        });
      })
      .catch((e) => {
        log('error', 'Failed get user media', e);
        cb(null);
      });
  };

  public handleVideoAnswerMsg: RTCInterface['handleVideoAnswerMsg'] = (msg, cb) => {
    const {
      id,
      data: { sdp, userId },
    } = msg;
    log('info', 'Call recipient has accepted our call');
    const desc = new RTCSessionDescription(sdp);
    console.warn(2, sdp.sdp);
    this.peerConnections[userId]
      .setRemoteDescription(desc)
      .then(() => {
        cb(0);
      })
      .catch((e) => {
        log('error', 'Error set description for answer:', e);
        cb(1);
      });
  };

  public closeVideoCall: RTCInterface['closeVideoCall'] = ({ targetUserId }) => {
    log('info', 'Closing the call');
    this.peerConnections[targetUserId].onicecandidate = null;
    this.peerConnections[targetUserId].oniceconnectionstatechange = null;
    this.peerConnections[targetUserId].onicegatheringstatechange = null;
    this.peerConnections[targetUserId].onsignalingstatechange = null;
    this.peerConnections[targetUserId].onnegotiationneeded = null;
    this.peerConnections[targetUserId].ontrack = null;
    this.peerConnections[targetUserId].close();
  };
}

export default RTC;
