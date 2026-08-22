import { useCallback, useEffect, useState } from 'react'
import type { DesktopUpdateCheckResult } from '../robbot-api'

export type UpdateCheckState =
  | { status: 'idle'; result?: null; message?: string }
  | { status: 'checking'; result?: null; message?: string }
  | { status: 'latest'; result: DesktopUpdateCheckResult; message?: string }
  | { status: 'available'; result: DesktopUpdateCheckResult; message?: string }
  | { status: 'failed'; result?: null; message: string }

type CachedUpdateCheck = {
  checkedAt: number
  result: DesktopUpdateCheckResult
}

const updateChannel = 'stable'
const oneDayMs = 24 * 60 * 60 * 1000

export function useDesktopUpdateCheck(enabled: boolean) {
  const [appVersion, setAppVersion] = useState('')
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckState>({ status: 'idle' })

  const checkUpdate = useCallback(async (options?: { force?: boolean }) => {
    const version = appVersion || await window.robbot.app.getVersion()
    if (!appVersion) setAppVersion(version)

    const input = {
      platform: window.robbot.app.platform,
      arch: window.robbot.app.arch,
      version,
      channel: updateChannel,
    }
    const cacheKey = updateCacheKey(input)

    if (!options?.force) {
      const cached = readCachedUpdateCheck(cacheKey)
      if (cached && Date.now() - cached.checkedAt < oneDayMs) {
        setUpdateCheck({
          status: cached.result.hasUpdate ? 'available' : 'latest',
          result: cached.result,
        })
        return cached.result
      }
    }

    setUpdateCheck({ status: 'checking' })
    try {
      console.log('[robbot:update] check desktop update request', input)
      const result = await window.robbot.app.checkUpdate(input)
      console.log('[robbot:update] check desktop update result', result)
      writeCachedUpdateCheck(cacheKey, result)
      setUpdateCheck({
        status: result.hasUpdate ? 'available' : 'latest',
        result,
      })
      return result
    } catch (cause) {
      console.error('[robbot:update] check desktop update failed', cause)
      setUpdateCheck({
        status: 'failed',
        message: cause instanceof Error ? cause.message : String(cause),
      })
      return null
    }
  }, [appVersion])

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    void window.robbot.app.getVersion()
      .then((version) => {
        if (cancelled) return
        setAppVersion(version)
        void checkUpdateOncePerDay(version, setUpdateCheck)
      })
      .catch(() => {
        if (!cancelled) setAppVersion('')
      })

    return () => {
      cancelled = true
    }
  }, [enabled])

  return {
    appVersion,
    updateCheck,
    checkUpdate,
    hasUpdate: updateCheck.status === 'available',
  }
}

async function checkUpdateOncePerDay(version: string, setUpdateCheck: (state: UpdateCheckState) => void) {
  const input = {
    platform: window.robbot.app.platform,
    arch: window.robbot.app.arch,
    version,
    channel: updateChannel,
  }
  const cacheKey = updateCacheKey(input)
  const cached = readCachedUpdateCheck(cacheKey)

  if (cached && Date.now() - cached.checkedAt < oneDayMs) {
    setUpdateCheck({
      status: cached.result.hasUpdate ? 'available' : 'latest',
      result: cached.result,
    })
    return
  }

  setUpdateCheck({ status: 'checking' })
  try {
    console.log('[robbot:update] check desktop update request', input)
    const result = await window.robbot.app.checkUpdate(input)
    console.log('[robbot:update] check desktop update result', result)
    writeCachedUpdateCheck(cacheKey, result)
    setUpdateCheck({
      status: result.hasUpdate ? 'available' : 'latest',
      result,
    })
  } catch (cause) {
    console.error('[robbot:update] check desktop update failed', cause)
    setUpdateCheck({
      status: 'failed',
      message: cause instanceof Error ? cause.message : String(cause),
    })
  }
}

function updateCacheKey(input: { platform: string; arch: string; version: string; channel: string }) {
  return `robbot:update-check:${input.platform}:${input.arch}:${input.version}:${input.channel}`
}

function readCachedUpdateCheck(cacheKey: string): CachedUpdateCheck | null {
  try {
    const cached = window.localStorage.getItem(cacheKey)
    if (!cached) return null
    const parsed = JSON.parse(cached) as CachedUpdateCheck
    return typeof parsed.checkedAt === 'number' && parsed.result ? parsed : null
  } catch {
    return null
  }
}

function writeCachedUpdateCheck(cacheKey: string, result: DesktopUpdateCheckResult) {
  try {
    window.localStorage.setItem(cacheKey, JSON.stringify({ checkedAt: Date.now(), result }))
  } catch {
    return
  }
}
