const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const http = require('http');
const cors = require('cors')

const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');
const port = parseInt(process.env.PORT || '3000')

const app = express();
app.set('port', port);

app.use(cors())
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);


const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
  cors: {
    origin: '*',
  }
});

const generate_room_code = require('./lib/generate_room_code')

const roomConfig = {
  default: {
    creator: 'socketId',
    max_user: -1, // infinity
    room_type: 'public', // or private (invited only)
    users: [
      {
        id: 'socketId',
        username: 'string'
      }
    ],
    messages: [
      {
        type: 'create',
        user: 'socketId',
        content: 'socketId create the room'
      },
      {
        type: 'join',
        user: 'socketId',
        content: 'socketId join the room'
      },
      {
        type: 'chat',
        user: 'socketId',
        content: '<chat content>'
      },
      {
        type: 'kick',
        user: 'socketId creator',
        content: 'socketId kicked by creator'
      },
      {
        type: 'leave',
        user: 'socketId',
        content: 'socketId leave the room'
      }
    ]
  }
}


io.on('connection', (socket) => {

  console.log(`user ${socket.id} connected to the server`)

  socket.on('create room', (username, callback) => {
    const roomCode = generate_room_code(io)
    const user = {
      id: socket.id,
      username
    }
    socket.join(roomCode)

    roomConfig[roomCode] = {
      code: roomCode,
      creator: socket.id,
      max_user: -1,
      room_type: 'public',
      users: [user],
      messages: [
        {
          type: 'create',
          user: socket.id,
          content: `${username} create the room`
        },
      ]
    }
    callback(roomCode, roomConfig[roomCode])

    console.log(`room ${roomCode} created`)
  })

  socket.on('config room', (roomCode, config, callback) => {
    // Make sure only creator that can configure the room
    if (roomConfig[roomCode]?.creator === socket.id) {
      console.log('given config')
      console.log(config)
      roomConfig[roomCode] = {
        ...roomConfig[roomCode],
        ...config,
        creator: socket.id        // In Case creator have been replaced by given config accidentally
      }

      console.log('current config')
      console.log(roomConfig[roomCode])

      // broadcast to all other people in the room about new room config
      socket.to(roomCode).emit('new room config', roomConfig[roomCode])
      callback(roomConfig[roomCode])

      console.log(`config for room ${roomCode} changed`)
    }
  })

  socket.on('join room', (roomCode, username, inviter, callback) => {
    // if room does not exist
    if (!io.sockets.adapter.rooms.get(roomCode)) {
      callback(roomCode, 'error', 'Room does not exist')
      console.log('room does not exist')
    }
    // if user try to manually join room even though the room is private
    else if (roomConfig[roomCode].room_type !== 'public' && (inviter === null || roomConfig[roomCode].creator !== inviter)) {
      callback(roomCode, 'error', 'Room is private')
      console.log('room is private')
    }
    // if room is already at maximum capacity
    else if (io.sockets.adapter.rooms.get(roomCode).size === roomConfig[roomCode].max_user) {
      callback(roomCode, 'error', 'Room is full')
      console.log('room is full')
    }
    // if everything is alright ...
    else {
      // ... identify as new user
      const user = {
        id: socket.id,
        username
      }

      // then, join the room
      roomConfig[roomCode].users.push(user)
      roomConfig[roomCode].messages.push({
        type: 'join',
        user: socket.id,
        content: `${username} join the room`
      })
      socket.join(roomCode)

      // Broadcast to all other people in the room that you are joined the room
      socket.to(roomCode).emit('joined room', roomConfig[roomCode])
      callback(roomCode, 'success', roomConfig[roomCode])

      console.log(`${socket.id} joined room ${roomCode}`)
    }
  })

  socket.on('leave room', (roomCode) => {
    // If the creator leave the room, then all other user will also leave the room
    console.log(roomConfig[roomCode]?.creator)
    if (roomConfig[roomCode]?.creator === socket.id) {
      io.sockets.adapter.rooms.get(roomCode).forEach(client => {
        io.sockets.sockets.get(client).leave(roomCode)
      })
      delete roomConfig[roomCode]
      console.log(`creator of room ${roomCode} leaved the room`)
    } else {
      const leavedUsername = roomConfig[roomCode].users.find(user => user.id === socket.id)?.username
      roomConfig[roomCode].users = roomConfig[roomCode].users.filter(user => user.id !== socket.id)
      roomConfig[roomCode].messages.push({
        type: 'leave',
        user: socket.id,
        content: `${leavedUsername} leave the room`
      })

      // Broadcast to all other people in the room before you leave the room
      socket.to(roomCode).emit('leaved room', roomConfig[roomCode])
      socket.leave(roomCode)

      console.log(`${socket.id} leaved room ${roomCode}`)
    }
  })

  socket.on('kick person', (roomCode, socketId, callback) => {
    console.log('kick person')
    console.log(socket.id)
    console.log(roomConfig[roomCode])
    console.log(socket.id === roomConfig[roomCode]?.creator)
    if (roomConfig[roomCode]?.creator !== socket.id) {
      // error, non creator cannot kick other people in the room
      callback('error', 'non creator cannot kick other people in the room')
      console.log('non creator cannot kick other people in the room')
    }
    else if (socketId === socket.id) {
      // error, cant kick theirself
      callback('error', 'cant kick yourself')
      console.log('cant kick yourself')
    }
    else {
      const kickedUsername = roomConfig[roomCode].users.find(user => user.id === socketId)?.username
      roomConfig[roomCode].users = roomConfig[roomCode].users.filter(user => user.id !== socketId)
      roomConfig[roomCode].messages.push({
        type: 'kick',
        user: socket.id,
        content: `${kickedUsername} kicked by creator`
      })

      socket.to(socketId).emit('kicked', roomCode)
      io.sockets.sockets.get(socketId).leave(roomCode)
      socket.to(roomCode).emit('someone kicked', roomConfig[roomCode])
      callback('success', roomConfig[roomCode])
      console.log(`creator kicked ${socketId} from room ${roomCode}`)
    }
  })

  socket.on('chat', (roomCode, content, callback) => {

    const user = roomConfig[roomCode].users.find(user => user.id === socket.id)
    roomConfig[roomCode].messages.push({
      type: 'chat',
      user: socket.id,
      content
    })
    socket.to(roomCode).emit('new chat', roomConfig[roomCode])
    callback(roomConfig[roomCode])

    console.log(`${socket.id} give message to room ${roomCode}`)
  })

  socket.on('disconnecting', () => {
    socket.rooms.forEach(room => {
      if (room !== socket.id && roomConfig[room].creator === socket.id) {
        console.log(`remove room ${room}`)
        io.sockets.adapter.rooms.get(room).forEach(client => {
          io.sockets.sockets.get(client).leave(room)
        })
        delete roomConfig[room]
      }
    })
  })

  socket.on('disconnect', () => {
    console.log(`user ${socket.id} disconnected from the server`)
  })
});

server.listen(port, () => {
  console.log(`listen on port ${port}`)
});
