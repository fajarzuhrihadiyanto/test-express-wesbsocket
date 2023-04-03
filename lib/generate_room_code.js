const generate_random_string = require('./generate_random_string')
const ROOM_CODE_LENGTH = 5

const generate_room_code = (io) => {
  let roomCode = generate_random_string(ROOM_CODE_LENGTH)

  while (io.sockets.adapter.rooms[roomCode]) {
    roomCode = generate_random_string(ROOM_CODE_LENGTH)
  }

  return roomCode
}

module.exports = generate_room_code