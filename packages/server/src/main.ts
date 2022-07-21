/******************************************************************************************
 * Repository: https://github.com/kolserdav/react-node-webrtc-sfu.git
 * File name: main.ts
 * Author: Sergey Kolmiller
 * Email: <uyem.ru@gmail.com>
 * License: MIT
 * License text:
 * Copyright: kolserdav, All rights reserved (c)
 * Create Date: Thu Jul 14 2022 16:24:49 GMT+0700 (Krasnoyarsk Standard Time)
 ******************************************************************************************/
/* eslint-disable no-case-declarations */
import { v4 } from 'uuid';
import dotenv from 'dotenv';
dotenv.config();
import WS from './core/ws';
import RTC from './core/rtc';
import { MessageType } from './types/interfaces';
import { log } from './utils/lib';
import { PORT, DATABASE_URL } from './utils/constants';
import DB from './core/db';

const db = new DB();

process.on('uncaughtException', (err: Error) => {
  log('error', 'uncaughtException', err);
});
process.on('unhandledRejection', (err: Error) => {
  log('error', 'unhandledRejection', err);
});

const deleteGuest = ({ userId, roomId }: { userId: string | number; roomId: string | number }) => {
  return new Promise((resolve) => {
    db.roomFindFirst({
      where: {
        id: roomId.toString(),
      },
      select: {
        Guests: {
          where: {
            unitId: userId.toString(),
          },
        },
      },
    }).then((g) => {
      if (!g) {
        log('warn', 'Can not unitFindFirst', { userId });
        resolve(0);
        return;
      }
      db.roomUpdate({
        where: {
          id: roomId.toString(),
        },
        data: {
          Guests: {
            delete: g.Guests[0]?.id
              ? {
                  id: g.Guests[0]?.id,
                }
              : undefined,
          },
          updated: new Date(),
        },
      }).then((r) => {
        if (!r) {
          log('warn', 'Room not delete guest', { roomId, id: g.Guests[0]?.id });
          resolve(1);
        }
        log('info', 'Guest deleted', { roomId, id: g.Guests[0]?.id });
        resolve(0);
      });
    });
  });
};

/**
 * Create SFU WebRTC server
 */
function createServer({ port = PORT, cors = '' }: { port?: number; cors?: string; db?: string }) {
  log('info', 'Server listen at port:', port, true);
  const getConnectionId = (): string => {
    const connId = v4();
    if (wss.sockets[connId]) {
      return getConnectionId();
    }
    return connId;
  };

  const wss = new WS({ port });
  const rtc: RTC | null = new RTC({ ws: wss });

  wss.connection.on('connection', function connection(ws, req) {
    const { origin } = req.headers;
    const notAllowed = cors.split(',').indexOf(origin || '') === -1;
    if (cors && notAllowed) {
      ws.close();
      log('warn', 'Block CORS attempt', { headers: req.headers });
      return;
    }
    const connId = getConnectionId();
    ws.on('message', async function message(message) {
      let _data = '';
      if (typeof message !== 'string') {
        _data = message.toString('utf8');
      }
      const rawMessage = wss.parseMessage(_data);
      if (!rawMessage) {
        return;
      }
      const { type, id } = rawMessage;
      switch (type) {
        case MessageType.GET_USER_ID:
          const { isRoom } = wss.getMessage(MessageType.GET_USER_ID, rawMessage).data;
          await wss.setSocket({ id, ws, connId, isRoom: isRoom || false });
          wss.sendMessage({
            type: MessageType.SET_USER_ID,
            id,
            data: undefined,
            connId,
          });
          break;
        case MessageType.GET_ROOM:
          rtc.handleGetRoomMessage({
            message: wss.getMessage(MessageType.GET_ROOM, rawMessage),
            port,
            cors,
          });
          break;
        case MessageType.GET_ROOM_GUESTS:
          const _roomId = wss.getMessage(MessageType.GET_ROOM_GUESTS, rawMessage).data.roomId;
          wss.sendMessage({
            type: MessageType.SET_ROOM_GUESTS,
            id,
            data: {
              roomUsers: rtc.rooms[_roomId],
              muteds: rtc.muteds[_roomId],
            },
            connId,
          });
          break;
        case MessageType.GET_MUTE:
          const { muted, roomId } = wss.getMessage(MessageType.GET_MUTE, rawMessage).data;
          const index = rtc.muteds[roomId].indexOf(id.toString());
          if (muted) {
            if (index === -1) {
              rtc.muteds[roomId].push(id.toString());
            }
          } else {
            rtc.muteds[roomId].splice(index, 1);
          }
          rtc.rooms[roomId].forEach((item) => {
            wss.sendMessage({
              type: MessageType.SET_MUTE,
              id: item,
              connId: '',
              data: {
                muteds: rtc.muteds[roomId],
              },
            });
          });
          break;
        default:
          wss.sendMessage(rawMessage);
      }
    });

    const getUserId = () => {
      let userId: number | string = 0;
      const keys = Object.keys(wss.sockets);
      keys.forEach((item) => {
        const sock = item.split(rtc.delimiter);
        if (sock[1] === connId) {
          userId = sock[0];
        }
      });
      return userId;
    };

    // Remove user from room
    ws.onclose = async () => {
      const userId = getUserId();
      if (userId) {
        const socketId = wss.getSocketId(userId, connId);
        if (wss.sockets[socketId]) {
          log('log', 'Delete socket', { userId, connId });
          delete wss.sockets[socketId];
        } else {
          log('warn', 'No socket delete', { s: Object.keys(wss.sockets) });
        }

        db.unitUpdate({
          where: {
            id: userId.toString(),
          },
          data: {
            online: false,
            updated: new Date(),
          },
        });
        log('info', 'User disconnected', userId);

        const roomKeys = Object.keys(rtc.rooms);
        roomKeys.forEach((item) => {
          const index = rtc.rooms[item].indexOf(userId);
          if (index !== -1) {
            const keys = Object.keys(rtc.peerConnections);
            rtc.cleanConnections(item, userId.toString());
            rtc.rooms[item].splice(index, 1);
            const mute = rtc.muteds[item].indexOf(userId.toString());
            if (mute !== -1) {
              rtc.muteds[item].splice(mute, 1);
            }
            // Send user list of room
            rtc.rooms[item].forEach((_item) => {
              let _connId = connId;
              keys.forEach((i) => {
                const peer = i.split(rtc.delimiter);
                if (
                  (peer[1] === _item && peer[2] === userId.toString()) ||
                  (peer[1] === userId.toString() && peer[2] === _item)
                ) {
                  _connId = peer[3];
                }
              });
              wss.sendMessage({
                type: MessageType.SET_CHANGE_UNIT,
                id: _item,
                data: {
                  roomLenght: rtc.rooms[item].length,
                  muteds: rtc.muteds[item],
                  target: userId,
                  eventName: 'delete',
                },
                connId: _connId,
              });
            });
            if (rtc.rooms[item].length === 0) {
              delete rtc.rooms[item];
              // set room is archive
              db.roomUpdate({
                where: {
                  id: item.toString(),
                },
                data: {
                  archive: true,
                  updated: new Date(),
                },
              });
              delete rtc.muteds[item];
            }
            deleteGuest({ userId, roomId: item });
            delete wss.users[userId];
          }
        });
      }
    };
  });
}
export default createServer;

if (require.main === module) {
  createServer({ port: PORT, cors: 'http://localhost:3000', db: DATABASE_URL });
}
