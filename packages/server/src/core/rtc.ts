/******************************************************************************************
 * Repository: https://github.com/kolserdav/react-node-webrtc-sfu.git
 * File name: rtc.ts
 * Author: Sergey Kolmiller
 * Email: <uyem.ru@gmail.com>
 * License: MIT
 * License text:
 * Copyright: kolserdav, All rights reserved (c)
 * Create Date: Thu Jul 14 2022 16:24:49 GMT+0700 (Krasnoyarsk Standard Time)
 ******************************************************************************************/
import * as werift from 'werift';
import { RTCInterface, MessageType, SendMessageArgs, AddTracksProps } from '../types/interfaces';
import { log } from '../utils/lib';
import WS from './ws';
import DB from './db';

const db = new DB();

class RTC implements Omit<RTCInterface, 'peerConnections' | 'createRTC'> {
  public peerConnectionsServer: RTCInterface['peerConnectionsServer'] = {};
  public readonly delimiter = '_';
  public rooms: Record<string | number, (string | number)[]> = {};
  public muteds: Record<string, string[]> = {};
  private ws: WS;
  public streams: Record<string, werift.MediaStream> = {};

  constructor({ ws }: { ws: WS }) {
    this.ws = ws;
  }

  public getPeerId(
    id: number | string,
    userId: number | string,
    target: number | string,
    connId: string
  ) {
    return `${id}${this.delimiter}${userId}${this.delimiter}${target || 0}${
      this.delimiter
    }${connId}`;
  }

  public createRTCServer: RTCInterface['createRTCServer'] = ({
    roomId,
    userId,
    target,
    connId,
    mimeType,
  }) => {
    const peerId = this.getPeerId(roomId, userId, target, connId);
    this.peerConnectionsServer[peerId] = new werift.RTCPeerConnection({
      codecs: {
        audio: [
          new werift.RTCRtpCodecParameters({
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 2,
          }),
        ],
        video: [
          new werift.RTCRtpCodecParameters({
            mimeType,
            clockRate: 90000,
            rtcpFeedback: [
              { type: 'transport-cc' },
              { type: 'ccm', parameter: 'fir' },
              { type: 'nack' },
              { type: 'nack', parameter: 'pli' },
              { type: 'goog-remb' },
            ],
          }),
        ],
      },
      iceTransportPolicy: 'all',
      bundlePolicy: 'disable',
    });

    return this.peerConnectionsServer;
  };

  public getRevPeerId(peerId: string) {
    const peer = peerId.split(this.delimiter);
    return {
      peerId: `${peer[0]}${this.delimiter}${peer[2]}${this.delimiter}${peer[1]}${this.delimiter}${peer[3]}`,
      userId: peer[2],
      target: peer[1],
      connId: peer[3],
      id: peer[0],
    };
  }

  public handleIceCandidate: RTCInterface['handleIceCandidate'] = ({
    roomId,
    userId,
    target,
    connId,
  }) => {
    const peerId = this.getPeerId(roomId, userId, target, connId);
    if (!this.peerConnectionsServer[peerId]) {
      log('warn', 'Handle ice candidate without peerConnection', { peerId });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const core = this;
    const { ws, delimiter, rooms } = this;
    this.peerConnectionsServer[peerId]!.onsignalingstatechange =
      function handleSignalingStateChangeEvent() {
        if (!core.peerConnectionsServer[peerId]) {
          log('warn', 'On signalling state change without peer connection', { peerId });
          return;
        }
        log(
          'info',
          '! WebRTC signaling state changed to:',
          core.peerConnectionsServer[peerId]!.signalingState
        );
        switch (core.peerConnectionsServer[peerId]!.signalingState) {
          case 'closed':
            core.onClosedCall({ roomId, userId, target, connId });
            break;
        }
      };
    let s = 1;
    this.peerConnectionsServer[peerId]!.ontrack = (e) => {
      const peer = peerId.split(delimiter);
      const isRoom = peer[2] === '0';
      const stream = e.streams[0];
      const isNew = stream.id !== this.streams[peerId]?.id;
      log('info', 'ontrack', {
        peerId,
        isRoom,
        si: stream.id,
        isNew,
        userId: peer[1],
        target: peer[2],
        tracks: stream.getTracks().map((item) => item.kind),
      });
      if (isRoom) {
        if (s % 2 !== 0 && isNew) {
          this.streams[peerId] = new werift.MediaStream({ id: stream.id });
          const room = rooms[roomId];
          if (room) {
            setTimeout(() => {
              room.forEach((id) => {
                ws.sendMessage({
                  type: MessageType.SET_CHANGE_UNIT,
                  id,
                  data: {
                    target: userId,
                    eventName: 'add',
                    roomLenght: rooms[roomId]?.length || 0,
                    muteds: this.muteds[roomId],
                  },
                  connId,
                });
              });
            }, 0);
          } else {
            log('warn', 'Room missing in memory', { roomId });
          }
        }
        this.streams[peerId].addTrack(stream.getTracks()[0]);
        s++;
      } else {
        const tracksOpts: AddTracksProps = {
          peerId,
          roomId: peer[0],
          userId,
          target,
          connId: peer[3],
        };
        log('info', 'Add tracks', {
          tracksOpts,
          s,
          kinds: stream.getTracks().map((item) => item.kind),
        });
        this.addTracks(tracksOpts, () => {
          /** */
        });
      }
    };
  };

  public handleCandidateMessage: RTCInterface['handleCandidateMessage'] = async (msg, cb) => {
    const {
      id,
      connId,
      data: { candidate, userId, target },
    } = msg;
    let peerId = this.getPeerId(id, userId, target, connId);
    let _connId = connId;
    if (!this.peerConnectionsServer?.[peerId]) {
      const peer = Object.keys(this.peerConnectionsServer).find((p) => {
        const pe = p.split(this.delimiter);
        return (
          pe[0] === id.toString() && pe[1] === userId.toString() && pe[2] === target.toString()
        );
      });
      _connId = peer?.split(this.delimiter)[3] || connId;
      peerId = this.getPeerId(id, userId, target, _connId);
    }
    const cand = new werift.RTCIceCandidate(candidate as werift.RTCIceCandidate);

    log('log', 'Trying to add ice candidate:', {
      peerId,
      d: Object.keys(this.peerConnectionsServer).length,
      connId,
      id,
      userId,
      target,
    });
    if (this.peerConnectionsServer[peerId]?.connectionState === 'new') {
      await new Promise((resolve) => {
        const t = setInterval(() => {
          if (this.peerConnectionsServer[peerId]?.connectionState !== 'new') {
            clearInterval(t);
            resolve(0);
          }
        }, 500);
      });
    }
    if (
      !this.peerConnectionsServer[peerId] ||
      this.peerConnectionsServer[peerId]?.connectionState === 'closed' ||
      this.peerConnectionsServer[peerId]?.iceConnectionState === 'closed'
    ) {
      log('warn', 'Skiping add ice candidate', {
        connId,
        id,
        userId,
        peerId,
        target,
        state: this.peerConnectionsServer[peerId]?.connectionState,
        ice: this.peerConnectionsServer[peerId]?.iceConnectionState,
        ss: this.peerConnectionsServer[peerId]?.signalingState,
      });
      return;
    }
    if (cand.candidate === '') {
      return;
    }
    this.peerConnectionsServer[peerId]!.addIceCandidate(cand)
      .then(() => {
        log('log', '!! Adding received ICE candidate:', { userId, id, target });
        if (cb) {
          cb(cand as RTCIceCandidate);
        }
      })
      .catch((e) => {
        log('error', 'Set ice candidate error', {
          error: e,
          connId,
          id,
          userId,
          target,
          state: this.peerConnectionsServer[peerId]?.connectionState,
          ice: this.peerConnectionsServer[peerId]?.iceConnectionState,
          ss: this.peerConnectionsServer[peerId]?.signalingState,
        });
        if (cb) {
          cb(null);
        }
      });
  };

  public handleOfferMessage: RTCInterface['handleOfferMessage'] = (msg, cb) => {
    const {
      id,
      connId,
      data: { sdp, userId, target, mimeType },
    } = msg;
    if (!sdp) {
      log('warn', 'Message offer error because sdp is:', sdp);
      if (cb) {
        cb(null);
      }
      return;
    }
    const peerId = this.getPeerId(id, userId, target, connId);

    this.createRTCServer({
      roomId: id,
      userId,
      target,
      connId,
      mimeType,
    });

    if (!this.peerConnectionsServer[peerId]) {
      log('warn', 'Handle offer message without peer connection', { peerId });
      return;
    }
    this.handleIceCandidate({
      roomId: id,
      userId,
      target,
      connId,
    });
    const desc = new werift.RTCSessionDescription(sdp.sdp as string, 'offer');
    this.peerConnectionsServer[peerId]!.setRemoteDescription(desc)
      .then(() => {
        log('info', '-> Local video stream obtained', { peerId });
      })
      .then(() => {
        log('info', '--> Creating answer', {
          peerId,
          ss: this.peerConnectionsServer[peerId]?.signalingState,
        });
        if (!this.peerConnectionsServer[peerId]) {
          log('warn', 'Create answer without peer connection', { peerId });
          return;
        }
        this.peerConnectionsServer[peerId]!.createAnswer().then((answ) => {
          if (!answ) {
            log('error', 'Failed set local description for answer.', {
              answ,
              peerConnection: this.peerConnectionsServer[peerId],
            });
            if (cb) {
              cb(null);
            }
            return;
          }
          log('info', '---> Setting local description after creating answer');
          let _peerId = peerId;
          if (!this.peerConnectionsServer[peerId]) {
            _peerId = this.getPeerId(id, target, userId, connId);
          }
          if (!this.peerConnectionsServer[_peerId]) {
            log('warn', 'Skip set local description fo answer', {
              roomId: id,
              userId,
              target,
              connId,
              k: Object.keys(this.peerConnectionsServer).length,
              s: Object.keys(this.streams).length,
            });
            return;
          }
          this.peerConnectionsServer[_peerId]!.setLocalDescription(answ)
            .catch((err) => {
              log('error', 'Error set local description for answer', {
                message: err.message,
                roomId: id,
                userId,
                target,
                connId,
                k: Object.keys(this.peerConnectionsServer).length,
                s: Object.keys(this.streams).length,
                is: this.peerConnectionsServer[peerId]?.iceConnectionState,
                cs: this.peerConnectionsServer[peerId]?.connectionState,
                ss: this.peerConnectionsServer[peerId]?.signalingState,
              });
            })
            .then(() => {
              const { localDescription } = this.peerConnectionsServer[peerId]!;
              if (localDescription) {
                log('info', 'Sending answer packet back to other peer', { userId, target, id });
                this.ws.sendMessage({
                  id: userId,
                  type: MessageType.ANSWER,
                  data: {
                    sdp: localDescription,
                    userId: id,
                    target,
                  },
                  connId,
                });
                if (cb) {
                  cb(null);
                }
              } else {
                log('warn', 'Failed send answer because localDescription is', localDescription);
              }
            });
        });
      })
      .catch((e) => {
        log('error', 'Failed get user media', {
          message: e.message,
          stack: e.stack,
          roomId: id,
          userId,
          target,
          connId,
          desc: desc !== undefined,
        });
        if (cb) {
          cb(null);
        }
      });
  };

  public handleVideoAnswerMsg: RTCInterface['handleVideoAnswerMsg'] = async (msg, cb) => {
    const {
      id,
      connId,
      data: { sdp, userId, target },
    } = msg;
    const peerId = this.getPeerId(userId, id, target, connId);
    log('info', '----> Call recipient has accepted our call', {
      id,
      userId,
      target,
      peerId,
      s: this.peerConnectionsServer[peerId]?.connectionState,
      is: this.peerConnectionsServer[peerId]?.iceConnectionState,
    });
    if (!this.peerConnectionsServer[peerId]) {
      await new Promise((resolve) => {
        setTimeout(() => {
          resolve(0);
        }, 1000);
      });
    }
    if (!this.peerConnectionsServer[peerId]) {
      log('warn', 'Skiping set remote desc for answer', {
        id,
        userId,
        target,
        peerId,
        peer: this.peerConnectionsServer[peerId],
      });
      return;
    }
    const desc = new werift.RTCSessionDescription(sdp.sdp as string, 'answer');
    this.peerConnectionsServer[peerId]!.setRemoteDescription(desc)
      .then(() => {
        if (cb) {
          cb(0);
        }
      })
      .catch((e) => {
        log('error', 'Error set description for answer', e);
        if (cb) {
          cb(1);
        }
      });
  };

  public addTracks: RTCInterface['addTracks'] = ({ roomId, connId, userId, peerId, target }) => {
    let _connId = connId;
    const keysStreams = Object.keys(this.streams);
    keysStreams.forEach((element) => {
      const str = element.split(this.delimiter);
      if (str[1] === target.toString() && str[2] === '0') {
        _connId = str[3];
      }
    });
    const _peerId = this.getPeerId(roomId, target, 0, _connId);
    const stream = this.streams[_peerId];
    const tracks = stream?.getTracks();

    log('info', 'Add tracks', {
      roomId,
      userId,
      target,
      connId,
      _peerId,
      peerId,
      tracksL: tracks?.length,
      _connId,
      id: stream?.id,
      tracks: tracks?.map((item) => item.kind),
      ss: Object.keys(this.streams),
      p: Object.keys(this.peerConnectionsServer),
      c: this.peerConnectionsServer[peerId]?.connectionState,
    });

    if (!stream) {
      log('info', 'Skiping add track', {
        roomId,
        userId,
        target,
        connId,
        _peerId,
        _connId,
        con: connId === _connId,
        k: Object.keys(this.streams),
      });
      return;
    }
    tracks.forEach((track) => {
      if (this.peerConnectionsServer[peerId]) {
        const sender = this.peerConnectionsServer[peerId]!.getSenders().find(
          (item) => item.kind === track.kind
        );
        if (sender && sender?.track?.id === track.id) {
          this.peerConnectionsServer[peerId]?.removeTrack(sender);
        }
        this.peerConnectionsServer[peerId]!.addTrack(track, stream);
      }
    });
  };

  public closeVideoCall: RTCInterface['closeVideoCall'] = ({ roomId, userId, target, connId }) => {
    const peerId = this.getPeerId(roomId, userId, target, connId);
    delete this.streams[peerId];
    if (!this.peerConnectionsServer[peerId]) {
      log('warn', 'Close video call without peer connection', { peerId });
      return;
    }
    log('info', '| Closing the call', {
      peerId,
      k: Object.keys(this.peerConnectionsServer).length,
    });
    setTimeout(() => {
      if (this.peerConnectionsServer[peerId]) {
        this.peerConnectionsServer[peerId]!.onicecandidate = null;
        this.peerConnectionsServer[peerId]!.onsignalingstatechange = null;
        this.peerConnectionsServer[peerId]!.onnegotiationneeded = null;
        this.peerConnectionsServer[peerId]!.ontrack = null;
        this.peerConnectionsServer[peerId]!.close();
        delete this.peerConnectionsServer[peerId];
      }
    }, 1000);
  };

  public async addUserToRoom({
    userId,
    roomId,
  }: {
    userId: number | string;
    roomId: number | string;
  }): Promise<1 | 0> {
    const room = await db.roomFindFirst({
      where: {
        id: roomId.toString(),
      },
    });
    if (!room) {
      const authorId = userId.toString();
      db.roomCreate({
        data: {
          id: roomId.toString(),
          authorId,
          Guests: {
            create: {
              unitId: authorId,
            },
          },
        },
      });
    } else {
      if (room.archive) {
        if (room.authorId !== userId.toString()) {
          this.ws.sendMessage({
            type: MessageType.SET_ERROR,
            id: userId,
            connId: '',
            data: {
              message: 'Room is inactive',
              context: {
                id: userId,
                type: MessageType.SET_ROOM,
                connId: '',
                data: {
                  roomId,
                },
              },
            },
          });
          if (!this.rooms[roomId]) {
            this.rooms[roomId] = [];
            this.muteds[roomId] = [];
          }
          return 1;
        } else {
          await db.roomUpdate({
            where: {
              id: room.id,
            },
            data: {
              archive: false,
              updated: new Date(),
            },
          });
        }
      }

      db.unitFindFirst({
        where: {
          id: userId.toString(),
        },
        select: {
          IGuest: {
            select: {
              id: true,
            },
          },
        },
      }).then((g) => {
        const id = roomId.toString();
        if (!g) {
          log('warn', 'Unit not found', { id: userId.toString() });
        } else if (!g?.IGuest[0]) {
          db.unitUpdate({
            where: {
              id: userId.toString(),
            },
            data: {
              IGuest: {
                create: {
                  roomId: id,
                },
              },
              updated: new Date(),
            },
          }).then((r) => {
            if (!r) {
              log('warn', 'Room not updated', { roomId });
            }
          });
        } else if (g.IGuest[0].id) {
          db.unitUpdate({
            where: {
              id: userId.toString(),
            },
            data: {
              IGuest: {
                update: {
                  where: {
                    id: g.IGuest[0].id,
                  },
                  data: {
                    updated: new Date(),
                  },
                },
              },
            },
          });
        } else {
          log('warn', 'Room not saved', { g: g.IGuest[0]?.id, id });
        }
      });
    }
    if (!this.rooms[roomId]) {
      this.rooms[roomId] = [userId];
      this.muteds[roomId] = [];
    } else if (this.rooms[roomId].indexOf(userId) === -1) {
      this.rooms[roomId].push(userId);
    } else {
      log('info', 'Room exists and user added before.', { roomId, userId });
    }
    return 0;
  }

  public async handleGetRoomMessage({
    message,
    port,
    cors,
  }: {
    message: SendMessageArgs<MessageType.GET_ROOM>;
    port: number;
    cors: string;
  }) {
    log('log', 'Get room message', message);
    const {
      data: { userId: uid, mimeType },
      id,
      connId,
    } = message;
    const error = await this.addUserToRoom({
      roomId: id,
      userId: uid,
    });
    if (error) {
      this.ws.sendMessage({
        type: MessageType.SET_ROOM,
        id: uid,
        data: undefined,
        connId,
      });
      log('warn', 'Can not add user to room', { id, uid });
      return;
    }
    this.createRTCServer({ roomId: id, userId: uid, target: 0, connId, mimeType });
    const connection = new this.ws.websocket(`ws://localhost:${port}`, {
      headers: {
        origin: cors.split(',')[0],
      },
    });
    connection.onopen = () => {
      log('info', 'On open room', { roomId: id, userId: uid, target: 0, connId, mimeType });
      connection.send(
        JSON.stringify({
          type: MessageType.GET_USER_ID,
          id,
          data: {
            isRoom: true,
          },
          connId: '',
        })
      );
      connection.onmessage = (mess) => {
        const msg = this.ws.parseMessage(mess.data as string);
        if (msg) {
          const { type } = msg;
          switch (type) {
            case MessageType.OFFER:
              this.handleOfferMessage(msg);
              break;
            case MessageType.ANSWER:
              this.handleVideoAnswerMsg(msg);
              break;
            case MessageType.CANDIDATE:
              this.handleCandidateMessage(msg);
              break;
          }
        }
      };
    };
    this.ws.sendMessage({
      type: MessageType.SET_ROOM,
      id: uid,
      data: undefined,
      connId,
    });
  }

  public onClosedCall: RTCInterface['onClosedCall'] = (args) => {
    log('info', 'Call is closed', { ...args });
  };

  public cleanConnections(roomId: string, userId: string) {
    const peerKeys = Object.keys(this.peerConnectionsServer);
    peerKeys.forEach((__item) => {
      const peer = __item.split(this.delimiter);
      if (peer[1] === userId.toString()) {
        this.closeVideoCall({
          roomId,
          userId,
          target: peer[2],
          connId: peer[3],
        });
      } else if (peer[2] === userId.toString()) {
        this.closeVideoCall({
          roomId,
          userId: peer[1],
          target: userId,
          connId: peer[3],
        });
      }
    });
  }
}

export default RTC;
