/******************************************************************************************
 * Repository: https://github.com/kolserdav/react-node-webrtc-sfu.git
 * File name: Room.tsx
 * Author: Sergey Kolmiller
 * Email: <uyem.ru@gmail.com>
 * License: MIT
 * License text:
 * Copyright: kolserdav, All rights reserved (c)
 * Create Date: Thu Jul 14 2022 16:24:49 GMT+0700 (Krasnoyarsk Standard Time)
 ******************************************************************************************/
import React, { useMemo, useContext, useRef } from 'react';
import { getRoomId, log } from '../utils/lib';
import s from './Room.module.scss';
import { RoomProps } from '../types/index';
import {
  useConnection,
  useVideoDimensions,
  useOnclickClose,
  usePressEscape,
  useVideoStarted,
} from './Room.hooks';
import ThemeContext from '../Theme.context';
import { getRoomLink, getPathname, onClickVideo, copyLink, supportDisplayMedia } from './Room.lib';
import CloseButton from './ui/CloseButton';
import ScreenIcon from '../Icons/ScreeenIcon';
import IconButton from './ui/IconButton';
import CameraIcon from '../Icons/CameraIcon';
import MicrophoneIcon from '../Icons/MicrophoneIcon';
import MicrophoneOffIcon from '../Icons/MicrophoneOffIcon';
import CameraOutlineOffIcon from '../Icons/CameraOutlineOffIcon';
import CameraOutlineIcon from '../Icons/CameraOutlineIcon';
import CopyIcon from '../Icons/CopyIcon';
import WarningIcon from '../Icons/ErrorIcon';

function Room({ id, iceServers, server, port }: RoomProps) {
  const pathname = getPathname();
  const container = useRef<HTMLDivElement>(null);
  const roomId = useMemo(() => getRoomId(pathname || ''), [pathname]);
  const roomLink = useMemo(() => getRoomLink(roomId), [roomId]);
  const {
    streams,
    lenght,
    lostStreamHandler,
    screenShare,
    shareScreen,
    muted,
    changeMuted,
    muteds,
    video,
    ws,
    rtc,
    changeVideo,
    error,
  } = useConnection({
    id,
    roomId,
    iceServers,
    server,
    port: port.toString(),
  });
  const theme = useContext(ThemeContext);
  const setVideoDimensions = useVideoDimensions({
    container: container.current,
    lenght,
  });
  const onClickClose = useOnclickClose({ container: container.current, lenght });
  const onPressEscape = usePressEscape();
  const { played, setPlayed } = useVideoStarted({
    streams,
    ws,
    rtc,
    container: container.current,
    roomId,
    lostStreamHandler,
  });
  const displayMediaSupported = useMemo(() => supportDisplayMedia(), []);
  return (
    <div className={s.wrapper} style={theme.wrapper}>
      <div className={s.container} ref={container}>
        {streams.map((item, index) => (
          <div id={item.stream.id} key={item.target} className={s.video}>
            {/** CloseButton is strong first child */}
            <CloseButton
              onClick={(e) => {
                lostStreamHandler({
                  target: item.target,
                  connId: item.connId,
                  eventName: '',
                });
                onClickClose(e);
              }}
              onKeyDown={onPressEscape}
              tabindex={index}
            />
            {/** video is strong second child */}
            <video
              autoPlay
              muted={item.target === id || muteds.indexOf(item.target.toString()) !== -1}
              onTimeUpdate={(e) => {
                if (item.stream.active === false) {
                  log('warn', 'Stream is not active', { uid: item.target, sid: item.stream.id });
                  lostStreamHandler({
                    target: item.target,
                    connId: item.connId,
                    eventName: 'stream-not-active',
                  });
                } else {
                  setVideoDimensions(e, item.stream);
                  if (!played[item.target]) {
                    const _played = { ...played };
                    _played[item.target] = true;
                    setPlayed(_played);
                  }
                }
              }}
              onClick={onClickVideo}
              ref={item.ref}
              title={item.target.toString()}
              id={item.target.toString()}
              onLoadedData={(e) => {
                log('log', 'On loaded data', { ...item });
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { target }: { target: HTMLVideoElement } = e as any;
                target.play();
                if (!played[item.target]) {
                  const _played = { ...played };
                  _played[item.target] = true;
                  setPlayed(_played);
                }
              }}
              onEmptied={(e) => {
                log('warn', 'Empty video data', { active: item.stream.active, id: item.target });
              }}
              onSuspend={(e) => {
                log('warn', 'Suspend video data', { active: item.stream.active, id: item.target });
                lostStreamHandler({
                  target: item.target,
                  connId: item.connId,
                  eventName: 'suspend-video-data',
                });
              }}
              onStalled={(e) => {
                log('warn', 'Stalled video data', { active: item.stream.active, id: item.target });
              }}
              onAbort={(e) => {
                log('warn', 'Abort video data', { active: item.stream.active, id: item.target });
              }}
              onEnded={(e) => {
                log('warn', 'End video data', { active: item.stream.active, id: item.target });
              }}
              onWaiting={(e) => {
                log('warn', 'Waiting video data', {
                  active: item.stream.active,
                  id: item.target,
                  t: (e.target as HTMLVideoElement).played,
                });
              }}
            />
            <div className={s.muted}>
              {muteds.indexOf(item.target.toString()) !== -1 && <MicrophoneOffIcon color="#fff" />}
            </div>
          </div>
        ))}
        {error && (
          <div className={s.error}>
            <WarningIcon color={theme.colors.yellow} />
            {error}
          </div>
        )}
      </div>
      <div className={s.actions}>
        {roomLink && (
          <div className={s.link__container}>
            <input disabled className={s.link__input} value={roomLink} />
            <IconButton onClick={() => copyLink(roomLink)}>
              <CopyIcon color={theme.colors.text} />
            </IconButton>
          </div>
        )}
        {displayMediaSupported && (
          <IconButton onClick={screenShare}>
            {shareScreen ? (
              <CameraIcon color={theme.colors.text} />
            ) : (
              <ScreenIcon color={theme.colors.text} />
            )}
          </IconButton>
        )}
        <IconButton onClick={changeMuted}>
          {muted ? (
            <MicrophoneOffIcon color={theme.colors.text} />
          ) : (
            <MicrophoneIcon color={theme.colors.text} />
          )}
        </IconButton>
        <IconButton onClick={changeVideo}>
          {video ? (
            <CameraOutlineIcon color={theme.colors.text} />
          ) : (
            <CameraOutlineOffIcon color={theme.colors.text} />
          )}
        </IconButton>
      </div>
    </div>
  );
}

export default Room;
