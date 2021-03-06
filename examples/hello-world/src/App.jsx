// @ts-check

import React from 'react';
import Uyem from 'uyem';
import './App.css';

/**
 * Application get roomId from latest path section
 */
const createRoom = () => {
  // Do not use the symbol "_" in room address
  window.location.href = `/path/to/room-${new Date().getTime()}?uid=1`;
};

function App() {
  const isHall = window.location.pathname === '/';
  return (
    <div>
      {isHall ? (
        <button type="button" onClick={createRoom}>
          Create room
        </button>
      ) : (
        <Uyem
          room={{
            server: 'localhost',
            port: 3001,
            iceServers: [
              {
                urls: ['stun:127.0.0.1:3478'],
              },
              {
                urls: ['turn:127.0.0.2:3478'],
                username: 'username',
                credential: 'password',
              },
            ],
            id: window.location.search.replace(/\?uid=/, ''),
          }}
        />
      )}
    </div>
  );
}

export default App;
