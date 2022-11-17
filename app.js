import { config } from './config.js'

import express from 'express'
const app = express()

import https from 'httpolyglot'
import fs from 'fs'
import path from 'path'
const __dirname = path.resolve()

import { Server } from 'socket.io'

let urlPath = '/janus/'

app.get('*', (req, res, next) => {
	let path = urlPath
	if (req.path.indexOf(path) == 0 && req.path.length > path.length) return next()
	res.send("Specify a room")
})

app.use(`${urlPath}:room`, express.static(path.join(__dirname, 'public')))

const options = {
	key: fs.readFileSync(config.ssl.keyPath, 'utf-8'),
	cert: fs.readFileSync(config.ssl.certPath, 'utf-8')
}

const httpsServer = https.createServer(options, app)
httpsServer.listen(3000, () => {
	console.log('Listening on port: ' + 3000)
})
