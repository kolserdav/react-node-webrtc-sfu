/******************************************************************************************
 * Repository: https://github.com/kolserdav/react-node-webrtc-sfu.git
 * File name: Room.hooks.ts
 * Author: Sergey Kolmiller
 * Email: <uyem.ru@gmail.com>
 * License: MIT
 * License text:
 * Copyright: kolserdav, All rights reserved (c)
 * Create Date: Thu Jul 14 2022 16:24:49 GMT+0700 (Krasnoyarsk Standard Time)
 ******************************************************************************************/
/* eslint-disable no-case-declarations */
import { useEffect, useState, useMemo, useCallback } from 'react';
import WS from '../core/ws';
import RTC from '../core/rtc';
import { getCodec, log } from '../utils/lib';
import { getWidthOfItem } from './Room.lib';
import { MessageType, SendMessageArgs } from '../types/interfaces';
import { Stream } from '../types';
import s from './Room.module.scss';
import c from './ui/CloseButton.module.scss';
import storeStreams, { changeStreams } from '../store/streams';
import { START_DELAY } from '../utils/constants';

// eslint-disable-next-line import/prefer-default-export
export const useConnection = ({
  id,
  roomId,
  iceServers,
  server,
  port,
}: {
  id: number | string;
  roomId: number | string | null;
  iceServers: RTCConfiguration['iceServers'];
  server: string;
  port: string;
}) => {
  const [streams, setStreams] = useState<Stream[]>([]);
  const [shareScreen, setShareScreen] = useState<boolean>(false);
  const [localShareScreen, setLocalShareScreen] = useState<boolean>(false);
  const [selfStream, setSelfStream] = useState<Stream | null>(null);
  const [roomIsSaved, setRoomIsSaved] = useState<boolean>(false);
  const [lenght, setLenght] = useState<number>(streams.length);
  const [muted, setMuted] = useState<boolean>(false);
  const [muteds, setMuteds] = useState<string[]>([]);
  const [video, setVideo] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState<string>('');
  const ws = useMemo(
    () => new WS({ shareScreen: localShareScreen, server, port }),
    [localShareScreen, server, port]
  );
  const rtc = useMemo(() => new RTC({ ws }), [ws]);
  const screenShare = useMemo(
    () => (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      setShareScreen(!shareScreen);
    },
    [shareScreen]
  );

  const changeMuted = () => {
    if (!roomId) {
      return;
    }
    const _muted = !muted;
    setMuted(_muted);
    ws.sendMessage({
      type: MessageType.GET_MUTE,
      id: ws.userId,
      connId: '',
      data: {
        muted: !muted,
        roomId,
      },
    });
    if (rtc.localStream) {
      rtc.localStream.getAudioTracks()[0].enabled = !_muted;
    }
  };

  const changeVideo = () => {
    if (rtc.localStream) {
      const _video = !video;
      setVideo(_video);
      rtc.localStream.getVideoTracks()[0].enabled = _video;
    }
  };

  /**
   * Change media source
   */
  useEffect(() => {
    if (!roomId) {
      return;
    }
    if (localShareScreen !== shareScreen) {
      if (selfStream) {
        rtc.localStream = null;
        rtc.closeAllConnections();
        ws.connection.close();
        setLocalShareScreen(shareScreen);
        setRoomIsSaved(false);
        storeStreams.dispatch(changeStreams({ type: 'clean', stream: selfStream }));
        rtc.roomLength = 0;
        setLenght(0);
        setSelfStream(null);
      } else {
        log('warn', 'Change media source. Self stream is:', selfStream);
      }
    }
  }, [shareScreen, localShareScreen, roomId, rtc, ws, selfStream]);

  /**
   * Set streams from store
   */
  useEffect(() => {
    const cleanSubs = storeStreams.subscribe(() => {
      const state = storeStreams.getState();
      setStreams(state.streams);
    });
    return () => {
      cleanSubs();
    };
  }, []);

  /**
   * set self stream id
   */
  useEffect(() => {
    if (rtc.selfStreamId !== selfStream?.stream.id) {
      rtc.selfStreamId = selfStream?.stream.id;
    }
  }, [selfStream, rtc]);

  /**
   * Connections handlers
   */
  useEffect(() => {
    if (!roomId) {
      return () => {
        /** */
      };
    }
    if (!ws.userId) {
      ws.setUserId(id);
    }

    const lostStreamHandler: typeof rtc.lostStreamHandler = ({ connId, target, eventName }) => {
      if (!roomId) {
        return;
      }
      let _connId = connId;
      Object.keys(rtc.peerConnections).forEach((item) => {
        const peer = item.split(rtc.delimiter);
        if (peer[1] === target.toString()) {
          // eslint-disable-next-line prefer-destructuring
          _connId = peer[2];
        }
      });
      const peerId = rtc.getPeerId(roomId, target, _connId);
      if (!rtc.peerConnections[peerId]) {
        log('warn', 'Lost stream handler without peer connection', {
          peerId,
          k: Object.keys(rtc.peerConnections),
        });
        return;
      }
      rtc.closeVideoCall({ roomId, userId: ws.userId, target, connId: _connId });
      const _stream = streams.find((item) => item.target === target);
      if (_stream) {
        storeStreams.dispatch(changeStreams({ type: 'delete', stream: _stream }));
      }
    };

    rtc.lostStreamHandler = lostStreamHandler;

    const addStream = ({
      target,
      stream,
      connId,
      change = false,
    }: {
      target: string | number;
      stream: MediaStream;
      connId: string;
      change?: boolean;
    }) => {
      const _stream: Stream = {
        target,
        stream,
        connId,
        ref: (node) => {
          if (node) {
            // eslint-disable-next-line no-param-reassign
            node.srcObject = stream;
          }
        },
      };
      if (/-/.test(stream.id)) {
        return;
      }
      storeStreams.dispatch(changeStreams({ type: 'add', stream: _stream, change }));
      if (!selfStream && target === ws.userId) {
        setSelfStream(_stream);
      }
      log('info', 'Add stream', { _stream });
    };

    /**
     * 'add' send server/main.js and 'added' listen on Room.hooks.ts
     */
    const changeRoomUnitHandler = ({
      id: userId,
      data: { target, eventName, roomLenght, muteds: _muteds },
      connId,
    }: SendMessageArgs<MessageType.SET_CHANGE_UNIT>) => {
      if (lenght !== roomLenght) {
        setLenght(roomLenght);
      }
      rtc.muteds = _muteds;
      setMuteds(_muteds);
      switch (eventName) {
        case 'add':
        case 'added':
          if (userId !== target) {
            log('info', 'Change room unit handler', {
              userId,
              target,
              roomLenght,
              connId,
              eventName,
            });
            rtc.createPeerConnection({
              roomId,
              target,
              userId: id,
              connId,
              onTrack: ({ addedUserId, stream }) => {
                log('info', 'Added unit track', { addedUserId, s: stream.id, connId });
                addStream({ target: addedUserId, stream, connId });
              },
              iceServers,
              eventName: 'back',
            });
            rtc.addTracks({ roomId, userId, target, connId, peerId: '' }, (e) => {
              if (!e) {
                if (eventName !== 'added' && target !== userId) {
                  ws.sendMessage({
                    type: MessageType.SET_CHANGE_UNIT,
                    id: target,
                    connId,
                    data: {
                      target: userId,
                      roomLenght,
                      eventName: 'added',
                      muteds: _muteds,
                    },
                  });
                }
              }
            });
          }
          break;
        case 'delete':
          log('info', 'Need delete user', {
            roomId,
            target,
            userId,
            connId,
            k: Object.keys(rtc.peerConnections),
          });
          rtc.closeVideoCall({ roomId, target, userId, connId });
          const _stream = streams.find((item) => item.target === target);
          if (_stream) {
            storeStreams.dispatch(changeStreams({ type: 'delete', stream: _stream }));
          }
          break;
      }
    };

    const changeMuteHandler = (args: SendMessageArgs<MessageType.SET_MUTE>) => {
      const {
        data: { muteds: _muteds },
      } = args;
      rtc.muteds = _muteds;
      setMuteds(_muteds);
    };

    const reconnectHandler = ({
      id: _id,
      connId,
      data: { userId, roomId: _roomId },
    }: SendMessageArgs<MessageType.GET_NEED_RECONNECT>) => {
      let _connId = connId;
      Object.keys(rtc.peerConnections).forEach((item) => {
        const peer = item.split(rtc.delimiter);
        if (peer[0] === _roomId.toString() && peer[1] === userId.toString()) {
          // eslint-disable-next-line prefer-destructuring
          _connId = peer[2];
        }
      });
      rtc.addTracks(
        { roomId: _roomId, target: userId, userId: _id, connId: _connId, peerId: '' },
        () => {
          /** */
        }
      );
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const changeRoomGuestsHandler = ({
      rawMessage: {
        data: { roomUsers, muteds: _muteds },
        connId,
      },
    }: {
      rawMessage: SendMessageArgs<MessageType.SET_ROOM_GUESTS>;
    }) => {
      if (!roomId) {
        return;
      }
      rtc.muteds = _muteds;
      setMuteds(_muteds);
      const _streams: Stream[] = storeStreams.getState().streams as Stream[];
      log('info', 'onChangeRoomGuests', { roomUsers, id, st: _streams.map((i) => i.target) });
      // Add remote streams
      rtc.roomLength = roomUsers.length;
      setLenght(roomUsers.length);
      roomUsers.forEach((item) => {
        if (item !== id) {
          const peerId = rtc.getPeerId(roomId, item, connId);
          const _isExists = _streams.filter((_item) => item === _item.target);
          if (!_isExists[0]) {
            log('info', 'Check new user', { item, id });
            let s1 = 1;
            let fs: any;
            rtc.createPeerConnection({
              roomId,
              target: item,
              userId: id,
              connId,
              onTrack: ({ addedUserId, stream }) => {
                const self = stream.id === rtc.selfStreamId;
                const tracks = stream?.getTracks();
                log('warn', 'New user send tracks', {
                  item,
                  id,
                  addedUserId,
                  sid: stream.id,
                  self,
                  tracks: tracks?.map((_item) => _item.kind),
                });
                if (s1 === 2) {
                  // eslint-disable-next-line prefer-destructuring
                  fs = stream.getTracks()[0];
                }
                if (s1 === 3) {
                  const _stream = stream;
                  _stream.addTrack(fs);
                  alert(`${self} ${_stream?.getTracks().length}`);
                  addStream({ target: item, stream: _stream, connId, change: true });
                }
                s1++;
              },
              iceServers,
              eventName: 'check',
            });
            rtc.addTracks({ roomId, userId: ws.userId, target: item, connId, peerId: '' }, (e) => {
              log('info', 'Change room guests connection', {
                roomId,
                target: item,
                userId: id,
                connId,
              });
            }); /*
            setTimeout(() => {
              ws.sendMessage({
                type: MessageType.GET_NEED_RECONNECT,
                id: item,
                data: { userId: ws.userId, roomId },
                connId,
              });
            }, 2000); */
          } else if (rtc.peerConnections[peerId]) {
            const { connectionState } = rtc.peerConnections[peerId]!;
            switch (connectionState) {
              case 'closed':
              case 'failed':
              case 'disconnected':
                log('warn', 'Unclosed connection', {
                  peerId,
                  d: rtc.peerConnections[peerId]!.connectionState,
                });
                break;
            }
          } else {
            log('warn', 'Unhandled add tracks', {
              peerId,
              cs: rtc.peerConnections[peerId]?.connectionState,
            });
          }
        } else if (!streams.find((_item) => _item.target === ws.userId)) {
          const __streams = streams.map((_item) => _item);
          if (selfStream) {
            storeStreams.dispatch(changeStreams({ type: 'add', stream: selfStream }));
          } else {
            log('warn', 'Self stream is not defined', { __streams });
          }
        }
      });
      // Remove disconnected
      streams.forEach((item) => {
        const isExists = roomUsers.filter((_item) => _item === item.target);
        if (!isExists[0]) {
          Object.keys(rtc.peerConnections).forEach((__item) => {
            const peer = __item.split(rtc.delimiter);
            if (peer[1] === item.target) {
              streams.forEach((i, index) => {
                if (i.target === item.target) {
                  storeStreams.dispatch(changeStreams({ type: 'delete', stream: i }));
                }
              });
              rtc.closeVideoCall({
                roomId,
                userId: id,
                target: item.target,
                connId: peer[2],
              });
            }
          });
        }
        return isExists[0] !== undefined;
      });
    };
    ws.onOpen = () => {
      setTimeout(() => {
        ws.sendMessage({
          type: MessageType.GET_USER_ID,
          id,
          data: {},
          connId: '',
        });
      }, START_DELAY);
    };
    ws.onMessage = (ev) => {
      const { data } = ev;
      const rawMessage = ws.parseMessage(data);
      if (!rawMessage) {
        return;
      }
      const { type, connId } = rawMessage;
      switch (type) {
        case MessageType.SET_USER_ID:
          /**
           * Connect to room
           */
          setConnectionId(connId);
          rtc.connId = connId;
          ws.sendMessage({
            type: MessageType.GET_ROOM,
            id: roomId,
            data: {
              userId: id,
              mimeType: getCodec(),
            },
            connId,
          });
          break;
        case MessageType.OFFER:
          rtc.handleOfferMessage(rawMessage);
          break;
        case MessageType.CANDIDATE:
          rtc.handleCandidateMessage(rawMessage);
          break;
        case MessageType.SET_ROOM_GUESTS:
          changeRoomGuestsHandler({ rawMessage });
          break;
        case MessageType.SET_MUTE:
          changeMuteHandler(ws.getMessage(MessageType.SET_MUTE, rawMessage));
          break;
        case MessageType.ANSWER:
          rtc.handleVideoAnswerMsg(rawMessage);
          break;
        case MessageType.SET_ROOM:
          setRoomIsSaved(true);
          rtc.createPeerConnection({
            userId: ws.userId,
            target: 0,
            connId,
            roomId,
            onTrack: ({ addedUserId, stream }) => {
              log('info', '-> Added local stream to room', {
                addedUserId,
                id,
                tracks: stream?.getTracks().map((_item) => _item.kind),
                trackIds: stream?.getTracks().map((_item) => _item.id),
              });
              addStream({ target: addedUserId, stream, connId });
            },
            iceServers,
            eventName: 'first',
          });
          rtc.addTracks({ userId: ws.userId, roomId, connId, target: 0, peerId: '' }, (e) => {
            if (!e) {
              /** */
            } else if (localShareScreen) {
              ws.shareScreen = false;
              setLocalShareScreen(false);
              setShareScreen(false);
              ws.onOpen = () => {
                ws.sendMessage({
                  type: MessageType.GET_USER_ID,
                  id,
                  data: {},
                  connId: '',
                });
              };
            }
          });
          break;
        case MessageType.SET_CHANGE_UNIT:
          changeRoomUnitHandler(ws.getMessage(MessageType.SET_CHANGE_UNIT, rawMessage));
          break;
        case MessageType.GET_NEED_RECONNECT:
          reconnectHandler(ws.getMessage(MessageType.GET_NEED_RECONNECT, rawMessage));
          break;
        case MessageType.SET_ERROR:
          const {
            data: { message },
          } = ws.getMessage(MessageType.SET_ERROR, rawMessage);
          setError(message);
          log('warn', 'error', message);
          break;
        default:
      }
    };
    ws.onError = (e) => {
      log('error', 'Ws error', e);
    };
    ws.onClose = (e) => {
      log('warn', 'Ws close', e);
    };
    return () => {
      ws.onOpen = () => {
        /** */
      };
      ws.onMessage = () => {
        /** */
      };
      ws.onError = () => {
        /** */
      };
      ws.onClose = () => {
        /** */
      };
    };
  }, [
    roomId,
    streams,
    ws,
    rtc,
    id,
    roomIsSaved,
    lenght,
    selfStream,
    iceServers,
    localShareScreen,
    rtc.lostStreamHandler,
    rtc.selfStreamId,
  ]);

  /**
   * Check room list
   */
  useEffect(() => {
    if (!roomId) {
      return () => {
        //
      };
    }
    let interval = setTimeout(() => {
      //
    });
    let _streams: Stream[] = storeStreams.getState().streams as Stream[];
    interval = setInterval(() => {
      _streams = storeStreams.getState().streams as Stream[];
      if (_streams.length !== lenght) {
        ws.sendMessage({
          type: MessageType.GET_ROOM_GUESTS,
          id,
          connId: connectionId,
          data: {
            roomId,
          },
        });
      }
    }, 1000);

    return () => {
      clearTimeout(interval);
    };
  }, [roomId, ws, lenght, streams, connectionId, id, shareScreen]);

  return {
    streams,
    lenght,
    ws,
    rtc,
    lostStreamHandler: rtc.lostStreamHandler,
    screenShare,
    shareScreen,
    muted,
    changeMuted,
    muteds,
    video,
    changeVideo,
    error,
  };
};

export const useVideoDimensions = ({
  lenght,
  container,
}: {
  lenght: number;
  container: HTMLDivElement | null;
}) => {
  let time = 0;
  return useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement, Event>, stream: MediaStream) => {
      time++;
      if (time % 5 === 0) {
        requestAnimationFrame(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { target }: { target: HTMLVideoElement } = e as any;
          const _container =
            target.getAttribute('data') !== 'full'
              ? container
              : (target.parentElement as HTMLDivElement);
          if (_container) {
            const { videoHeight, videoWidth } = target;
            const coeff = videoWidth / videoHeight;
            const { width, cols, rows } = getWidthOfItem({
              lenght,
              container: _container,
              coeff: videoWidth / videoHeight,
            });
            // Change track constraints
            stream.getVideoTracks().forEach((item) => {
              const oldWidth = item.getConstraints().width;

              if (oldWidth !== width) {
                let _width = width;
                let _height = width;
                if (videoHeight < videoWidth) {
                  _height = Math.floor(width / coeff);
                  target.setAttribute('width', _width.toString());
                  target.setAttribute('height', _height.toString());
                } else {
                  _width = Math.floor(width * coeff);
                  target.setAttribute('width', _width.toString());
                  target.setAttribute('height', _height.toString());
                }
                target.parentElement?.parentElement?.setAttribute(
                  'style',
                  `grid-template-columns: repeat(${cols}, auto);
                  grid-template-rows: repeat(${rows}, auto);`
                );
                item
                  .applyConstraints(coeff < 1 ? { height: _height } : { width: _width })
                  .then(() => {
                    log('log', 'Constraints changed', {
                      width,
                      oldWidth,
                    });
                  })
                  .catch((error) => {
                    log('log', 'Constraints not changed', {
                      error,
                      width: _width,
                      height: _height,
                      oldWidth,
                    });
                  });
              }
            });
          }
        });
      }
    },
    [lenght, container, time]
  );
};

export const useOnclickClose =
  ({ lenght, container }: { lenght: number; container: HTMLDivElement | null }) =>
  (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    if (container) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { target }: any = e;
      const { nodeName } = target;
      const button: HTMLButtonElement =
        nodeName === 'path'
          ? target.parentElement?.parentElement
          : nodeName === 'svg'
          ? target.parentElement
          : target;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const video: HTMLVideoElement = button.nextElementSibling as any;
      const { videoWidth, videoHeight } = video;
      const { width } = getWidthOfItem({ lenght, container, coeff: videoWidth / videoHeight });
      const coeff = videoWidth / videoHeight;
      const height = width / coeff;
      video.parentElement?.classList.remove(s.video__fixed);
      button.classList.remove(c.open);
      video.setAttribute('data', '');
      video.setAttribute('width', width.toString());
      video.setAttribute('height', height.toString());
    }
  };

export const usePressEscape = () => (e: React.KeyboardEvent<HTMLDivElement>) => {
  /** TODO */
};

export const useVideoStarted = ({
  roomId,
  streams,
  ws,
  rtc,
  container,
  lostStreamHandler,
}: {
  roomId: string | number;
  streams: Stream[];
  ws: WS;
  rtc: RTC;
  container: HTMLDivElement | null;
  lostStreamHandler: typeof rtc.lostStreamHandler;
}) => {
  const [played, setPlayed] = useState<Record<string, boolean>>({});
  const [timeStart, setTimeStart] = useState<boolean>(false);
  const [attempts, setAttempts] = useState<Record<string | number, number>>({});

  /**
   * Check not played
   */
  useEffect(() => {
    let mounted = true;
    const timeout = setInterval(() => {
      const diffs: Stream[] = [];
      if (Object.keys(played).length === streams.length) {
        streams.forEach((item) => {
          const that = Object.keys(played).find(
            (_item) => _item === item.target.toString() && !played[_item]
          );
          if (that) {
            diffs.push(item);
          }
        });
      } else {
        streams.forEach((item) => {
          const that = Object.keys(played).find((_item) => _item === item.target.toString());
          if (!that) {
            diffs.push(item);
          }
        });
      }
      const _attempts = { ...attempts };
      diffs.forEach((item) => {
        if (!_attempts[item.target]) {
          _attempts[item.target] = 0;
        }
        if (_attempts[item.target] === 1) {
          if (!played[item.target] && mounted) {
            lostStreamHandler({ ...item, eventName: 'not-played' });
            const str = streams.find((i) => i.target === item.target);
            log('warn', 'Video not started', str?.stream.getTracks().length);
          }
        } else {
          log('info', `${_attempts[item.target]} attempts of restart:`, { target: item.target });
          if (_attempts[item.target] === 5) {
            _attempts[item.target] = 0;
            ws.sendMessage({
              type: MessageType.SET_CHANGE_UNIT,
              id: item.target,
              connId: item.connId,
              data: {
                target: ws.userId,
                roomLenght: rtc.roomLength,
                muteds: rtc.muteds,
                eventName: 'delete',
              },
            });
          }
        }

        if (_attempts[item.target] !== undefined) {
          _attempts[item.target] += 1;
        } else {
          _attempts[item.target] = 1;
        }
      });
      setAttempts(_attempts);
    }, 1000);
    return () => {
      clearInterval(timeout);
      mounted = false;
    };
  }, [played, streams, lostStreamHandler, attempts, ws, timeStart, rtc.muteds, rtc.roomLength]);

  return { played, setPlayed };
};
