/******************************************************************************************
 * Repository: https://github.com/kolserdav/react-node-webrtc-sfu.git
 * File name: interfaces.ts
 * Author: Sergey Kolmiller
 * Email: <uyem.ru@gmail.com>
 * License: MIT
 * License text:
 * Copyright: kolserdav, All rights reserved (c)
 * Create Date: Thu Jul 14 2022 16:24:49 GMT+0700 (Krasnoyarsk Standard Time)
 ******************************************************************************************/
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable max-classes-per-file */
/* eslint-disable no-unused-vars */
import { RTCPeerConnection as RTCPeerConnectionServer } from 'werift';
import { Prisma, Room, Unit, Message } from '@prisma/client';

export type SendMessageArgs<T> = Signaling.SendMessageArgs<T>;
export type WSInterface = Signaling.WSInterface;
export type RTCInterface = Connection.RTCInterface;
export type DBInterface = Data.DBInterface;
// eslint-disable-next-line @typescript-eslint/ban-types
export type ArgumentTypes<F extends Function> = F extends (args: infer A) => any ? A : never;

export enum MessageType {
  GET_USER_ID = 'GET_USER_ID',
  SET_USER_ID = 'SET_USER_ID',
  GET_LOGIN = 'GET_LOGIN',
  TOKEN = 'TOKEN',
  OFFER = 'OFFER',
  CANDIDATE = 'CANDIDATE',
  ANSWER = 'ANSWER',
  GET_ROOM = 'GET_ROOM',
  SET_ROOM = 'SET_ROOM',
  SET_ERROR = 'SET_ERROR',
  GET_ROOM_GUESTS = 'GET_ROOM_GUESTS',
  SET_ROOM_GUESTS = 'SET_ROOM_GUESTS',
  SET_CHANGE_UNIT = 'SET_CHANGE_UNIT',
  GET_MUTE = 'GET_MUTE',
  SET_MUTE = 'SET_MUTE',
  GET_NEED_RECONNECT = 'GET_NEED_RECONNECT',
}

export namespace DataTypes {
  export namespace MessageTypes {
    export type GetMute = {
      muted: boolean;
      roomId: string | number;
    };
    export type GetNeedReconnect = {
      userId: string | number;
      roomId: number | string;
    };
    export type GetRoomGuests = {
      roomId: number | string;
    };
    export type GetGuestId = {
      isRoom?: boolean;
    };
    export type SetChangeRoomUnit = {
      target: number | string;
      eventName: 'delete' | 'add' | 'added';
      roomLenght: number;
      muteds: string[];
    };
    export type SetGuestId = undefined;
    export type GetRoom = {
      userId: number | string;
      mimeType: string;
    };
    export type SetRoomGuests = {
      roomUsers: (number | string)[];
      muteds: string[];
    };
    export type SetRoom = undefined;
    export type SetError = {
      message: string;
      context: SendMessageArgs<any>;
    };
    export type SetMute = {
      muteds: string[];
    };
    export type Offer = {
      sdp: RTCSessionDescriptionInit;
      userId: number | string;
      target: number | string;
      mimeType: string;
    };
    export type Candidate = {
      candidate: RTCIceCandidate;
      userId: number | string;
      target: number | string;
    };
    export type Answer = {
      sdp: RTCSessionDescriptionInit;
      userId: number | string;
      target: number | string;
    };
    export type ConnectionId<T> = T extends infer R ? R : never;
  }

  export type ArgsSubset<T> = T extends MessageType.OFFER
    ? DataTypes.MessageTypes.Offer
    : T extends MessageType.ANSWER
    ? DataTypes.MessageTypes.Answer
    : T extends MessageType.CANDIDATE
    ? DataTypes.MessageTypes.Candidate
    : T extends MessageType.GET_MUTE
    ? DataTypes.MessageTypes.GetMute
    : T extends MessageType.GET_NEED_RECONNECT
    ? DataTypes.MessageTypes.GetNeedReconnect
    : T extends MessageType.GET_USER_ID
    ? DataTypes.MessageTypes.GetGuestId
    : T extends MessageType.SET_USER_ID
    ? DataTypes.MessageTypes.SetGuestId
    : T extends MessageType.GET_ROOM
    ? DataTypes.MessageTypes.GetRoom
    : T extends MessageType.SET_ROOM
    ? DataTypes.MessageTypes.SetRoom
    : T extends MessageType.GET_ROOM_GUESTS
    ? DataTypes.MessageTypes.GetRoomGuests
    : T extends MessageType.SET_ROOM_GUESTS
    ? DataTypes.MessageTypes.SetRoomGuests
    : T extends MessageType.SET_CHANGE_UNIT
    ? DataTypes.MessageTypes.SetChangeRoomUnit
    : T extends MessageType.SET_MUTE
    ? DataTypes.MessageTypes.SetMute
    : T extends MessageType.SET_ERROR
    ? DataTypes.MessageTypes.SetError
    : unknown;
}

export namespace Signaling {
  // eslint-disable-next-line @typescript-eslint/no-shadow
  export interface SendMessageArgs<T> {
    type: T;
    id: number | string;
    data: DataTypes.ArgsSubset<T>;
    connId: DataTypes.MessageTypes.ConnectionId<string>;
  }
  export abstract class WSInterface {
    public abstract connection: any;

    public readonly delimiter = '_';

    public abstract createConnection(args: any): any;

    public abstract parseMessage(text: string): SendMessageArgs<any> | null;

    public abstract getMessage<T extends keyof typeof MessageType>(
      type: T,
      message: SendMessageArgs<any>
    ): SendMessageArgs<T>;

    public abstract sendMessage: <T extends keyof typeof MessageType>(
      args: SendMessageArgs<T>,
      second?: boolean
    ) => Promise<1 | 0>;
  }
}

export namespace Connection {
  export type AddTracksProps = {
    roomId: number | string;
    connId: string;
    userId: number | string;
    target: number | string;
    peerId: string;
  };
  export abstract class RTCInterface {
    public abstract peerConnections: Record<string, RTCPeerConnection | undefined>;

    public abstract peerConnectionsServer: Record<string, RTCPeerConnectionServer | undefined>;

    public readonly delimiter = '_';

    public abstract createRTC(args: {
      connId: string;
      roomId: number | string;
      userId: number | string;
      target: string | number;
      iceServers?: RTCConfiguration['iceServers'];
    }): Record<number, RTCPeerConnection | undefined>;

    public abstract createRTCServer(args: {
      connId: string;
      roomId: number | string;
      userId: number | string;
      target: string | number;
      mimeType: string;
      iceServers?: RTCConfiguration['iceServers'];
    }): Record<number, RTCPeerConnectionServer | undefined>;

    public abstract handleIceCandidate(args: {
      connId: string;
      roomId: number | string;
      userId: number | string;
      target: string | number;
    }): any;

    public abstract getPeerId(...args: (number | string)[]): string;

    public abstract closeVideoCall(args: {
      connId: string;
      roomId: number | string;
      userId: number | string;
      target: string | number;
    }): void;

    public abstract onClosedCall(args: {
      connId: string;
      roomId: number | string;
      userId: number | string;
      target: string | number;
    }): void;

    public abstract handleOfferMessage(
      msg: Signaling.SendMessageArgs<MessageType.OFFER>,
      cb?: (desc: RTCSessionDescription | null) => any
    ): void;

    public abstract handleCandidateMessage(
      msg: Signaling.SendMessageArgs<MessageType.CANDIDATE>,
      cb?: (cand: RTCIceCandidate | null) => any
    ): void;

    public abstract handleVideoAnswerMsg(
      msg: Signaling.SendMessageArgs<MessageType.ANSWER>,
      cb?: (res: 1 | 0) => any
    ): void;

    public abstract addTracks(args: AddTracksProps, cb: (e: 1 | 0) => void): void;
  }
}

export type AddTracksProps = Connection.AddTracksProps;

export namespace Data {
  export abstract class DBInterface {
    public abstract roomCreate<T extends Prisma.RoomCreateArgs>(
      args: Prisma.SelectSubset<T, Prisma.RoomCreateArgs>,
      _connection?: WebSocket
    ): Promise<Prisma.CheckSelect<T, Room, Prisma.RoomGetPayload<T>> | null>;

    public abstract roomFindFirst<T extends Prisma.RoomFindFirstArgs>(
      args: Prisma.SelectSubset<T, Prisma.RoomFindFirstArgs>,
      _connection?: WebSocket
    ): Promise<Prisma.CheckSelect<T, Room, Prisma.RoomGetPayload<T>> | null>;

    public abstract roomUpdate<T extends Prisma.RoomUpdateArgs>(
      args: Prisma.SelectSubset<T, Prisma.RoomUpdateArgs>,
      _connection?: WebSocket
    ): Promise<Prisma.CheckSelect<T, Room, Prisma.RoomGetPayload<T>> | null>;

    public abstract unitUpdate<T extends Prisma.UnitUpdateArgs>(
      args: Prisma.SelectSubset<T, Prisma.UnitUpdateArgs>,
      _connection?: WebSocket
    ): Promise<Prisma.CheckSelect<T, Unit, Prisma.UnitGetPayload<T>> | null>;

    public abstract unitCreate<T extends Prisma.UnitCreateArgs>(
      args: Prisma.SelectSubset<T, Prisma.UnitCreateArgs>,
      _connection?: WebSocket
    ): Promise<Prisma.CheckSelect<T, Unit, Prisma.UnitGetPayload<T>> | null>;

    public abstract unitFindFirst<T extends Prisma.UnitFindFirstArgs>(
      args: Prisma.SelectSubset<T, Prisma.UnitFindFirstArgs>,
      _connection?: WebSocket
    ): Promise<Prisma.CheckSelect<T, Unit, Prisma.UnitGetPayload<T>> | null>;
  }
}

export namespace Handlers {
  export type Awaited<T> = T extends PromiseLike<infer U> ? U : T;
}
