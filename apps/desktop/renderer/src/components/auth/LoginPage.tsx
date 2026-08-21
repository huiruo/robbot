import { Alert, Box, Button, IconButton, InputAdornment, Paper, Tab, Tabs, TextField, Typography } from '@mui/material'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import type { AuthUser } from '../../robbot-api'

export function LoginPage(props: { onDone: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return setError('请输入正确的邮箱格式')
    if (!password) return setError('请输入密码')
    if (mode === 'register' && password.length < 6) return setError('密码至少 6 位')
    if (mode === 'register' && password !== confirm) return setError('两次密码不一致')

    setLoading(true)
    setError('')
    try {
      const user = mode === 'login'
        ? await window.robbot.auth.login({ email: normalizedEmail, password })
        : await window.robbot.auth.register({ email: normalizedEmail, password })
      props.onDone(user)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : mode === 'login' ? '登录失败' : '注册失败')
    } finally {
      setLoading(false)
    }
  }

  const passwordAdornment = (visible: boolean, toggle: () => void) => (
    <InputAdornment position="end"><IconButton onClick={toggle} edge="end" aria-label="显示密码">{visible ? <EyeOff size={18} /> : <Eye size={18} />}</IconButton></InputAdornment>
  )

  return <Box sx={{ minHeight: '100%', display: 'grid', placeItems: 'center', p: 2, background: 'linear-gradient(135deg, #f5f3ff, #f8fafc)' }}>
    <Paper component="form" onSubmit={submit} elevation={8} sx={{ width: 'min(440px, 100%)', p: { xs: 3, sm: 5 }, borderRadius: 4 }}>
      <Typography variant="h4" fontWeight={700} gutterBottom>欢迎回来</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>登录或注册后继续使用 Robbot</Typography>
      <Tabs value={mode} onChange={(_, value: 'login' | 'register') => { setMode(value); setError('') }} variant="fullWidth" sx={{ mb: 3 }}>
        <Tab value="login" label="登录" /><Tab value="register" label="注册" />
      </Tabs>
      <Box sx={{ display: 'grid', gap: 2 }}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <TextField label="邮箱" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" fullWidth disabled={loading} />
        <TextField label="密码" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} fullWidth disabled={loading} slotProps={{ input: { endAdornment: passwordAdornment(showPassword, () => setShowPassword((value) => !value)) } }} />
        {mode === 'register' ? <TextField label="确认密码" value={confirm} onChange={(event) => setConfirm(event.target.value)} type={showConfirm ? 'text' : 'password'} autoComplete="new-password" fullWidth disabled={loading} slotProps={{ input: { endAdornment: passwordAdornment(showConfirm, () => setShowConfirm((value) => !value)) } }} /> : null}
        <Button type="submit" variant="contained" size="large" disabled={loading} sx={{ mt: 1, py: 1.4 }}>{loading ? '处理中…' : mode === 'login' ? '登录' : '注册'}</Button>
      </Box>
      <Typography variant="caption" color="text.secondary" display="block" textAlign="center" sx={{ mt: 3 }}>继续即表示你同意服务条款，并了解隐私政策。</Typography>
    </Paper>
  </Box>
}
