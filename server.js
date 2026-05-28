const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

let players = {};

io.on('connection', socket => {
    console.log('Jogador conectado:', socket.id);

    players[socket.id] = {
        x: 200,
        y: 200
    };

    socket.on('move', data => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
        }
    });

    socket.on('disconnect', () => {
        console.log('Jogador saiu:', socket.id);
        delete players[socket.id];
    });
});

setInterval(() => {
    io.emit('players', players);
}, 1000 / 30);

server.listen(PORT, () => {
    console.log('Servidor rodando na porta ' + PORT);
});
