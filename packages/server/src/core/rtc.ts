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
import werift from 'wrtc';
import { RTCInterface, MessageType, SendMessageArgs, AddTracksProps } from '../types/interfaces';
import { log } from '../utils/lib';
import WS from './ws';
import DB from './db';

const db = new DB();

class RTC implements Omit<RTCInterface, 'peerConnectionsServer' | 'createRTCServer'> {
  public peerConnections: RTCInterface['peerConnections'] = {};
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

  public createRTC: RTCInterface['createRTC'] = ({ roomId, userId, target, connId }) => {
    const peerId = this.getPeerId(roomId, userId, target, connId);
    this.peerConnections[peerId] = new werift.RTCPeerConnection({
      iceServers: [],
      iceTransportPolicy: 'all',
    });

    return this.peerConnections;
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
    if (!this.peerConnections[peerId]) {
      log('warn', 'Handle ice candidate without peerConnection', { peerId });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const core = this;
    const { ws, delimiter, rooms } = this;
    this.peerConnections[peerId]!.onsignalingstatechange =
      function handleSignalingStateChangeEvent() {
        if (!core.peerConnections[peerId]) {
          log('warn', 'On signalling state change without peer connection', { peerId });
          return;
        }
        log(
          'info',
          '! WebRTC signaling state changed to:',
          core.peerConnections[peerId]!.signalingState
        );
        switch (core.peerConnections[peerId]!.signalingState) {
          case 'closed':
            core.onClosedCall({ roomId, userId, target, connId });
            break;
        }
      };
    let s = 1;
    this.peerConnections[peerId]!.ontrack = (e) => {
      const peer = peerId.split(delimiter);
      const isRoom = peer[2] === '0';
      const stream = e.streams[0];
      const isNew = stream.id !== this.streams[peerId]?.id;
      log('info', 'ontrack', {
        peerId,
        isRoom,
        si: stream.id,
        isNew,
        userId,
        target,
        tracks: stream.getTracks().map((item) => item.kind),
      });
      if (isRoom) {
        if (s % 2 !== 0 && isNew) {
          this.streams[peerId] = stream;
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
        s++;
      } else {
        const tracksOpts: AddTracksProps = {
          peerId,
          roomId,
          userId,
          target,
          connId,
        };
        log('info', 'Add tracks', { tracksOpts, s });
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
    if (!this.peerConnections?.[peerId]) {
      const peer = Object.keys(this.peerConnections).find((p) => {
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
      d: Object.keys(this.peerConnections).length,
      connId,
      id,
      userId,
      target,
    });
    if (this.peerConnections[peerId]?.connectionState === 'new') {
      await new Promise((resolve) => {
        const t = setInterval(() => {
          if (this.peerConnections[peerId]?.connectionState !== 'new') {
            clearInterval(t);
            resolve(0);
          }
        }, 500);
      });
    }
    if (
      !this.peerConnections[peerId] ||
      this.peerConnections[peerId]?.connectionState === 'closed' ||
      this.peerConnections[peerId]?.iceConnectionState === 'closed'
    ) {
      log('info', 'Skiping add ice candidate', {
        connId,
        id,
        userId,
        peerId,
        target,
        state: this.peerConnections[peerId]?.connectionState,
        ice: this.peerConnections[peerId]?.iceConnectionState,
        ss: this.peerConnections[peerId]?.signalingState,
      });
      return;
    }
    if (cand.candidate === '') {
      return;
    }
    this.peerConnections[peerId]!.addIceCandidate(cand)
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
          state: this.peerConnections[peerId]?.connectionState,
          ice: this.peerConnections[peerId]?.iceConnectionState,
          ss: this.peerConnections[peerId]?.signalingState,
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

    this.createRTC({
      roomId: id,
      userId,
      target,
      connId,
    });

    if (!this.peerConnections[peerId]) {
      log('warn', 'Handle offer message without peer connection', { peerId });
      return;
    }
    this.handleIceCandidate({
      roomId: id,
      userId,
      target,
      connId,
    });
    const desc = new werift.RTCSessionDescription(sdp);
    this.peerConnections[peerId]!.setRemoteDescription(desc)
      .then(() => {
        log('info', '-> Local video stream obtained', { peerId });
      })
      .then(() => {
        log('info', '--> Creating answer', {
          peerId,
          ss: this.peerConnections[peerId]?.signalingState,
        });
        this.peerConnections[peerId]!.createAnswer().then((answ) => {
          if (!answ) {
            log('error', 'Failed set local description for answer.', {
              answ,
              peerConnection: this.peerConnections[peerId],
            });
            if (cb) {
              cb(null);
            }
            return;
          }
          log('info', '---> Setting local description after creating answer');
          let _peerId = peerId;
          if (!this.peerConnections[peerId]) {
            _peerId = this.getPeerId(id, target, userId, connId);
          }
          if (!this.peerConnections[_peerId]) {
            log('warn', 'Skip set local description fo answer', {
              roomId: id,
              userId,
              target,
              connId,
              k: Object.keys(this.peerConnections).length,
              s: Object.keys(this.streams).length,
            });
            return;
          }
          this.peerConnections[_peerId]!.setLocalDescription(answ)
            .catch((err) => {
              log('error', 'Error set local description for answer', {
                message: err.message,
                roomId: id,
                userId,
                target,
                connId,
                k: Object.keys(this.peerConnections).length,
                s: Object.keys(this.streams).length,
                is: this.peerConnections[peerId]?.iceConnectionState,
                cs: this.peerConnections[peerId]?.connectionState,
                ss: this.peerConnections[peerId]?.signalingState,
              });
            })
            .then(() => {
              const { localDescription } = this.peerConnections[peerId]!;
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
      s: this.peerConnections[peerId]?.connectionState,
      is: this.peerConnections[peerId]?.iceConnectionState,
    });
    if (!this.peerConnections[peerId]) {
      await new Promise((resolve) => {
        setTimeout(() => {
          resolve(0);
        }, 1000);
      });
    }
    if (!this.peerConnections[peerId]) {
      log('warn', 'Skiping set remote desc for answer', {
        id,
        userId,
        target,
        peerId,
        peer: this.peerConnections[peerId],
      });
      return;
    }
    const desc = new werift.RTCSessionDescription(sdp);
    this.peerConnections[peerId]!.setRemoteDescription(desc)
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
    log('info', 'Add tracks ', {
      roomId,
      userId,
      target,
      connId,
      _peerId,
      tracksL: tracks?.length,
      _connId,
      id: stream?.id,
      tracks: tracks?.map((item) => item.kind),
      ss: Object.keys(this.streams),
    });
    if (!stream) {
      log('info', 'Skiping add track', {
        roomId,
        userId,
        target,
        connId,
        _peerId,
        _connId,
        k: Object.keys(this.streams),
      });
      return;
    }
    tracks.forEach((track) => {
      if (this.peerConnections[peerId]) {
        const sender = this.peerConnections[peerId]?.getSenders().find((item) => {
          return item?.track?.kind === track.kind;
        });
        if (sender) {
          this.peerConnections[peerId]!.removeTrack(sender);
        }
        this.peerConnections[peerId]!.addTrack(track, stream);
      }
    });
  };

  public closeVideoCall: RTCInterface['closeVideoCall'] = ({ roomId, userId, target, connId }) => {
    const peerId = this.getPeerId(roomId, userId, target, connId);
    delete this.streams[peerId];
    if (!this.peerConnections[peerId]) {
      log('warn', 'Close video call without peer connection', { peerId });
      return;
    }
    log('info', '| Closing the call', {
      peerId,
      k: Object.keys(this.peerConnections).length,
    });
    setTimeout(() => {
      if (this.peerConnections[peerId]) {
        this.peerConnections[peerId]!.onicecandidate = null;
        this.peerConnections[peerId]!.onsignalingstatechange = null;
        this.peerConnections[peerId]!.onnegotiationneeded = null;
        this.peerConnections[peerId]!.ontrack = null;
        this.peerConnections[peerId]!.close();
        delete this.peerConnections[peerId];
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
    this.createRTC({ roomId: id, userId: uid, target: 0, connId });
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
    const peerKeys = Object.keys(this.peerConnections);
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
