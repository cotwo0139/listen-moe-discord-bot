const Discord = require('discord.js')
const { Harusame } = require('harusame')
const chalk = require('chalk')

class Logger {
  static debug (message) {
    console.log(chalk.cyanBright(`[DEBUG] ${message}`))
  }

  static info (message) {
    console.log(chalk.greenBright(`[INFO] ${message}`))
  }
}

class Client extends Discord.Client {
  constructor (options) {
    super()
    this._options = options
    this.logger = Logger
    this.dispatchers = new Discord.Collection()
    this.listenMoeData = new Discord.Collection()
    this.listenMoeStreamURL = {
      JP: 'https://listen.moe/stream',
      KR: 'https://listen.moe/kpop/stream'
    }
    this.nowplayingMessages = new Discord.Collection()
    this.volumes = {}
    this.harusame = new Harusame({ attempts: 3, interval: 5000 })
      .on('debug', (name, msg) => this.logger.debug(`[Listen.moe] Websocket Name: ${name}, Debug Message: ${msg}`))
      .on('error', (name, error) => console.error(`Websocket Name: ${name}`, error))
      .on('close', (name, reason) => this.logger.debug(`[Listen.moe] Websocket Name: ${name}, Close Data: ${reason}`))
      .on('open', (name) => this.logger.info(`[Listen.moe] Websocket Name: ${name} is now open.`))
      .on('ready', (name) => this.logger.info(`[Listen.moe] Websocket Name: ${name} is now ready`))
      .on('songUpdate', (name, data) => {
        this.logger.debug(`[Listen.moe] WebSocket Name: ${name} data updated, ${JSON.stringify(data)}`)
        this.listenMoeData.set(name.replace('LISTEN.moe ', ''), data)
        this.updateMessage(name.replace('LISTEN.moe ', ''), data)
      })
  }

  _setUpClientEvents () {
    this.on('debug', (data) => {
      this.logger.debug(data)
    })
    this.on('ready', () => {
      this.logger.info('Bot Ready.')
      this.user.setActivity('Listen.moe', { type: 'LISTENING' })
      this.user.setStatus('idle')
    })
    this.on('message', (message) => {
      this.handleCommand(message)
    })
  }

  handleCommand (message) {
    if (message.channel.type === 'dm') return
    switch (message.content) {
      case 'l!jpop':
        this.leaveVoice(message.guild.id)
        this.joinVoice(message.member.voiceChannel).then((conn) => {
          this.createDispatcher(message.guild.id, conn, this.listenMoeStreamURL.JP)
          this.sendMessage(message.channel, this.buildEmbed(this.listenMoeData.get('JP')), 'JP')
        })
        break
      case 'l!kpop':
        this.leaveVoice(message.guild.id)
        this.joinVoice(message.member.voiceChannel).then((conn) => {
          this.createDispatcher(message.guild.id, conn, this.listenMoeStreamURL.KR)
          this.sendMessage(message.channel, this.buildEmbed(this.listenMoeData.get('KR')), 'KR')
        })
        break
      case 'l!np':
        this.sendMessage(message.channel, this.buildEmbed(this.listenMoeData.get(this.nowplayingMessages.get(message.guild.id).streamURL)), this.nowplayingMessages.get(message.guild.id).streamURL)
        break
      case 'l!shutdown':
        if (this._options.owners.includes(message.author.id)) {
          message.channel.send('💡  Shutting Down...').then(process.exit(1))
        }
        break
      case 'l!volume':
        if (!this.dispatchers.get(message.guild.id)) return message.channel.send('💡  First, You must playing radio')
        else {
          if (!this.volumes[message.guild.id]) this.volumes[message.guild.id] = 10
          const vol = message.content.split('l!volume').pop().trim()
          if (!vol) return message.channel.send(`💡  Current Volume: **${this.volumes[message.guild.id]}%**`)
          if (message.member.permissions.has('ADMINISTRATOR')) {
            if (Number.isNaN(Number(vol))) return message.channel.send('💡 Volume must be an integer')
            if (Number(vol) < 1) return message.channel.send('💡 Volume cannot be set to less than 1.')
            if (Number(vol) > 150) return message.channel.send('💡 You cannot set the volume to more than 150')
            this.setVolume(message.guild.id, Number(vol))
            return message.channel.send(`💡  Current Volume: **${this.volumes[message.guild.id]}%**`)
          }
        }
        break
      case 'l!stop':
        if (message.member.permissions.has('ADMINISTRATOR')) {
          this.leaveVoice(message.guild.id)
          return message.channel.send('💡 Stopped Radio.')
        }
        break
    }
  }

  leaveVoice (guildID) {
    if (this.dispatchers.get(guildID)) {
      this.dispatchers.get(guildID).voiceConnection.disconnect()
      this.dispatchers.get(guildID).dispatcher.end()
    }
  }

  sendMessage (channel, message, streamURL) {
    channel.send(message).then((m) => {
      this.nowplayingMessages.set(m.guild.id, { message: m, streamURL: streamURL })
    })
  }

  updateMessage (streamURL, newData) {
    if (this.nowplayingMessages.array().length === 0) return
    this.nowplayingMessages.array().filter(el => el.streamURL === streamURL).forEach((m) => {
      if (m.message.editable) {
        m.message.edit(this.buildEmbed(newData))
      }
    })
  }

  buildEmbed (data) {
    return new Discord.RichEmbed()
      .setColor('#FFDADA')
      .setAuthor('⭐ Now Playing...')
      .setDescription(`${Discord.Util.escapeMarkdown(data.songName)} - ${Discord.Util.escapeMarkdown(data.songArtist)}`)
      .setFooter(`🔖 ${Discord.Util.escapeMarkdown(data.songAlbum)} | 🎧 ${data.listeners} Listeners`, data.songCover === 'https://listen.moe/public/images/icons/apple-touch-icon.png' ? 'https://listen.moe/_nuxt/img/cd1c044.png' : data.songCover)
  }

  createDispatcher (guildID, voiceConnection, streamURL) {
    const dataObject = Object.assign({
      streamURL: streamURL,
      voiceConnection: voiceConnection,
      dispatcher: voiceConnection.playArbitraryInput(streamURL)
    })
    this.dispatchers.set(guildID, dataObject)
    this.setVolume(guildID, this.volumes[guildID])
  }

  setVolume (guildID, volume) {
    if (!volume) this.volumes[guildID] = 10
    if (this.dispatchers.get(guildID)) this.dispatchers.get(guildID).dispatcher.setVolumeLogarithmic(volume / 100)
  }

  joinVoice (voiceChannel) {
    return new Promise((resolve, reject) => {
      voiceChannel.join().then((connection) => {
        resolve(connection)
      }).catch((e) => {
        reject(e)
      })
    })
  }

  init () {
    this._setUpClientEvents()
    this.login(this._options.token)
  }
}

const client = new Client(require('./settings.js'))
client.init()
