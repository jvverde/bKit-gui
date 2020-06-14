import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  accessSync,
  constants
} from 'fs'

import { spawnSync, execSync } from 'child_process'
import { copySync } from 'fs-extra'
import { app, dialog } from 'electron'
import path from 'path'
import Shell from 'node-powershell'
import say from './say'
import Store from 'electron-store'
import runasAdmin from './runas'
import statics from './statics'

const store = new Store({ name: 'config' })
const get_config = () => store.get('config') || {}

let config = get_config()

export const load_config = () => {
  config = get_config() 
}

export const save_config = () => {
  config.lasttime = new Date(Date.now()).toISOString()
  store.set('config', config)
  say.log('Saved config')
}

export const bkitPath = (location) => {
  if (location && existsSync(location)) {
    config.bkit = location
    save_config()
  } else if (location) {
    throw new Error `'${location}' doen't exist`
  }
  return config.bkit
}

const mkdir = (path) => { return mkdirSync(path, { recursive: true }) }

const isWin = process.platform === 'win32'

const isAdmin = isWin && (() => {
  try{
    say.log('Check admin rights')
    execSync('NET SESSION') 
    return true
  } catch (err) {
    return false
  } 
})()

const isEmpty = (path) => readdirSync(path).length === 0

const checkRights = (dst) => {
  try {
    if (!existsSync(dst)) mkdir(dst)
    say.log('Test write access to', dst)
    accessSync(dst, constants.W_OK)
    say.log('Yes, I can write on', dst)
    return true
  } catch (err) {
    return false
  }
} 

const chosebkitLocation = (path) => {
  const result = dialog.showOpenDialogSync({
    title: 'Select a location for bkit client',
    defaultPath: path,
    buttonLabel: 'Choose',
    properties: ['openDirectory']
  })
  say.log('result', result)
  if (result && result instanceof Array) return result[0]
  else return null
}

const install2AlternateLocation = (fullpath, args = {}) => {
  const {
    title = "bkit client isn't installed yet",
    detail =  'Please choose a location for install it',
    buttons = ['Choose', 'Ignore'],
    message = fullpath ? `For some unknown reason you can't install on ${fullpath}` : ''
  } = args
  const option = dialog.showMessageBoxSync({
    title,
    detail,
    buttons,
    message,
    defaultId: 0,
    cancelId: 0
  })
  if (option === 0) {
    const location = chosebkitLocation(fullpath)
    if (location) {
      return install(location)
    } else {
      return install2AlternateLocation(fullpath, args)
    }
  } else if(option === 1) { 
    return null
  } else if (option > 1) {
    return option
  } else {
    say.log('Something else')
    return install2AlternateLocation(fullpath, args)
  }
}

const install = (dst) => {
  if (checkRights(dst)) {
    const client = path.join(statics, 'bkit-client')
    say.log('Sync', client, dst)
    copySync(client, dst)
    if (isWin) winInstall(dst)
    return dst
  } else {
    return install2AlternateLocation(dst)
  }
}

export const setupbkit = async (dst) => {
  say.log('Setup bkit', dst)
  if (isWin && !isAdmin) {
    await runasAdmin()
    load_config()
    return bkitPath()
  } else {
    const location = install(dst)
    say.log('Installation done to', location)

    config.bkit = location
    say.log('save bkit client location', config.bkit)
    save_config()

    if (isAdmin && app.commandLine.hasSwitch('elevated')) {
      say.log('The elevated run instance will quit now')
      app.quit()
    } else {
      return location
    }      
  }
}

const _getList = () => {
  try {
    const depends = path.join(statics, '/depends.lst')
    const result = readFileSync(depends, 'utf8')
    return result.split(/\r*\n+/).filter(e => e.match(/\.sh$/))
  } catch (err) {
    say.error('Catch _getList:', err)
  }
}

const list = _getList() || []

export const isbkitClintInstalled = (location) => {
  return location && existsSync(location) && list.every(e => {
    const fullpath = path.join(location, e)
    return existsSync(fullpath)
  })
}

const BASH = isWin ? 'bash.bat' : 'bash'

function bkitping (location) {
  try {
    say.log('bkitping on', location)
    const msg = 'aqui'
    const result = spawnSync(BASH, ['./bash.sh', 'echo', msg], { cwd: location, windowsHide: true })
    return result.stdout.toString().replace(/(\r|\n|\s)*$/, '') === msg
  } catch (err) {
    say.warn('bkitping fail:', err)
    return false
  }
}

function winInstall (location) {
  if (!isWin) return
  try {
    const result = spawnSync(
      'CMD',
      ['/C', 'setup.bat'],
      { cwd: location, windowsHide: false }
    )
    say.log('winInstall.stdout', result.stdout.toString())
    say.log('winInstall.stderr', result.stderr.toString())
    say.log('winInstall.status', result.status)
    say.log('winInstall.error', result.error)
    if (result.status !== 0) {
      install2AlternateLocation(location, winInstall)
    }
  } catch (err) {
    say.error('winInstall errors:', err)
  }
}

export const isbkitok = (location) => isbkitClintInstalled(location) && bkitping(location)

const options = [
  (location) => location.replace(/[\\\/]resources[\\\/].*$/i, ''),
  (location) => location.replace(/[\\\/][.]quasar[\\\/].*$/i, ''), // this is only for the development phase
  (location) => location
]

const LIMIT = 100
export const findbkit = (appath = app.getAppPath(), option = 0) => {
  if (option < options.length) {
    const base = options[option](appath)
    const location = path.join(base, 'bkit-client')
    say.log('Check bkit at', location)
    if (isbkitClintInstalled(location)) return location
    else return findbkit(appath, ++option)
  } else if (option < LIMIT) {
    const parent = path.dirname(appath)
    if (parent && parent !== appath) return findbkit(parent, ++option)
  }
  return null
}