import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import { signInWithRedirect } from 'aws-amplify/auth';
import { useAuth } from '../hooks/useAuth';
import { useTranslation } from '../i18n';

type LoginMode = 'login' | 'newPassword' | 'forgotPassword' | 'resetPassword';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [mode, setMode] = useState<LoginMode>('login');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const autoLoginAttempted = useRef(false);

  const { login, completeNewPassword, forgotPassword, confirmForgotPassword, error, clearError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const t = useTranslation();

  const from = location.state?.from?.pathname || '/';

  // Auto-fill and auto-login from URL params (invitation links)
  useEffect(() => {
    if (autoLoginAttempted.current) return;

    const urlEmail = searchParams.get('u');
    const urlPassword = searchParams.get('p');

    if (urlEmail && urlPassword) {
      autoLoginAttempted.current = true;
      setEmail(urlEmail);
      setPassword(urlPassword);

      // Clear URL params for security (don't leave credentials in URL/history)
      setSearchParams({}, { replace: true });

      // Auto-submit login
      (async () => {
        setIsSubmitting(true);
        try {
          const result = await login(urlEmail, urlPassword);
          if (result.needsNewPassword) {
            setMode('newPassword');
          } else {
            navigate(from, { replace: true });
          }
        } catch {
          // Error is handled by AuthContext, user can retry manually
        } finally {
          setIsSubmitting(false);
        }
      })();
    }
  }, [searchParams, setSearchParams, login, navigate, from]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      const result = await login(email, password);
      if (result.needsNewPassword) {
        setMode('newPassword');
      } else {
        navigate(from, { replace: true });
      }
    } catch {
      // Error is handled by AuthContext
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    if (newPassword !== confirmPassword) {
      return;
    }

    setIsSubmitting(true);

    try {
      await completeNewPassword(newPassword);
      navigate(from, { replace: true });
    } catch {
      // Error is handled by AuthContext
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      await forgotPassword(email);
      setMode('resetPassword');
      setSuccessMessage(t.login.verificationCodeSent);
    } catch {
      // Error is handled by AuthContext
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setSuccessMessage(null);

    if (newPassword !== confirmPassword) {
      return;
    }

    setIsSubmitting(true);

    try {
      await confirmForgotPassword(email, resetCode, newPassword);
      setSuccessMessage(t.login.passwordResetSuccess);
      setMode('login');
      setPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setResetCode('');
    } catch {
      // Error is handled by AuthContext
    } finally {
      setIsSubmitting(false);
    }
  };

  const goBackToLogin = () => {
    clearError();
    setSuccessMessage(null);
    setMode('login');
    setNewPassword('');
    setConfirmPassword('');
    setResetCode('');
  };

  // New Password Required form (after first login with temp password)
  if (mode === 'newPassword') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
              {t.login.setNewPassword}
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600">
              {t.login.newPasswordRequired}
            </p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleNewPassword}>
            {error && (
              <div className="rounded-md bg-red-50 p-4">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <div className="rounded-md shadow-sm -space-y-px">
              <div>
                <label htmlFor="new-password" className="sr-only">
                  {t.login.newPassword}
                </label>
                <input
                  id="new-password"
                  name="newPassword"
                  type="password"
                  required
                  className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                  placeholder={t.login.newPassword}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={10}
                />
              </div>
              <div>
                <label htmlFor="confirm-password" className="sr-only">
                  {t.login.confirmPassword}
                </label>
                <input
                  id="confirm-password"
                  name="confirmPassword"
                  type="password"
                  required
                  className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                  placeholder={t.login.confirmPassword}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={10}
                />
              </div>
            </div>

            {newPassword && confirmPassword && newPassword !== confirmPassword && (
              <p className="text-sm text-red-600">{t.login.passwordsDoNotMatch}</p>
            )}

            <p className="text-xs text-gray-500">
              {t.login.passwordRequirements}
            </p>

            <div>
              <button
                type="submit"
                disabled={isSubmitting || newPassword !== confirmPassword}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? t.login.settingPassword : t.login.setPassword}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Forgot Password form (enter email to receive code)
  if (mode === 'forgotPassword') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
              {t.login.resetPassword}
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600">
              {t.login.enterEmailForReset}
            </p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleForgotPassword}>
            {error && (
              <div className="rounded-md bg-red-50 p-4">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <div>
              <label htmlFor="reset-email" className="sr-only">
                {t.login.emailLabel}
              </label>
              <input
                id="reset-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder={t.login.emailPlaceholder}
                value={email}
                onChange={(e) => { clearError(); setEmail(e.target.value); }}
              />
            </div>

            <div className="flex flex-col space-y-3">
              <button
                type="submit"
                disabled={isSubmitting || !email}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? t.login.sending : t.login.sendResetCode}
              </button>
              <button
                type="button"
                onClick={goBackToLogin}
                className="text-sm text-indigo-600 hover:text-indigo-500"
              >
                {t.login.backToSignIn}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Reset Password form (enter code and new password)
  if (mode === 'resetPassword') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
              {t.login.enterNewPassword}
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600">
              {t.login.checkEmailForCode}
            </p>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleResetPassword}>
            {error && (
              <div className="rounded-md bg-red-50 p-4">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {successMessage && (
              <div className="rounded-md bg-green-50 p-4">
                <p className="text-sm text-green-700">{successMessage}</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label htmlFor="reset-code" className="block text-sm font-medium text-gray-700">
                  {t.login.verificationCode}
                </label>
                <input
                  id="reset-code"
                  name="code"
                  type="text"
                  required
                  className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  placeholder={t.login.enterCodeFromEmail}
                  value={resetCode}
                  onChange={(e) => { clearError(); setResetCode(e.target.value); }}
                />
              </div>

              <div className="rounded-md shadow-sm -space-y-px">
                <div>
                  <label htmlFor="new-password-reset" className="sr-only">
                    {t.login.newPassword}
                  </label>
                  <input
                    id="new-password-reset"
                    name="newPassword"
                    type="password"
                    required
                    className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                    placeholder={t.login.newPassword}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={10}
                  />
                </div>
                <div>
                  <label htmlFor="confirm-password-reset" className="sr-only">
                    {t.login.confirmPassword}
                  </label>
                  <input
                    id="confirm-password-reset"
                    name="confirmPassword"
                    type="password"
                    required
                    className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                    placeholder={t.login.confirmPassword}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    minLength={10}
                  />
                </div>
              </div>

              {newPassword && confirmPassword && newPassword !== confirmPassword && (
                <p className="text-sm text-red-600">{t.login.passwordsDoNotMatch}</p>
              )}

              <p className="text-xs text-gray-500">
                {t.login.passwordRequirements}
              </p>
            </div>

            <div className="flex flex-col space-y-3">
              <button
                type="submit"
                disabled={isSubmitting || newPassword !== confirmPassword || !resetCode}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? t.login.resetting : t.login.resetPassword}
              </button>
              <button
                type="button"
                onClick={goBackToLogin}
                className="text-sm text-indigo-600 hover:text-indigo-500"
              >
                {t.login.backToSignIn}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const handleFederatedSignIn = async (provider: 'Google') => {
    clearError();
    setSuccessMessage(null);
    setIsSubmitting(true);
    try {
      await signInWithRedirect({ provider });
      // Browser navigates away; nothing further to do here.
    } catch {
      setIsSubmitting(false);
    }
  };

  // Default: Login form
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            {t.login.title}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            {t.login.subtitle}
          </p>
        </div>

        <div className="mt-8 space-y-3">
          <button
            type="button"
            onClick={() => handleFederatedSignIn('Google')}
            disabled={isSubmitting}
            className="w-full flex justify-center items-center gap-2 py-2 px-4 border border-gray-300 rounded-md bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5c10.8 0 19.5-8.7 19.5-19.5 0-1.3-.1-2.4-.4-3.5z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z"/>
              <path fill="#4CAF50" d="M24 43.5c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.6 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.7 39 16.2 43.5 24 43.5z"/>
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.2 5.2c-.4.4 6.7-4.9 6.7-14.8 0-1.3-.1-2.4-.4-3.5z"/>
            </svg>
            {t.login.signInWithGoogle}
          </button>
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t border-gray-300" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-gray-50 px-2 text-gray-500">{t.login.or}</span>
          </div>
        </div>

        <form className="space-y-6" onSubmit={handleLogin}>
          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {successMessage && (
            <div className="rounded-md bg-green-50 p-4">
              <p className="text-sm text-green-700">{successMessage}</p>
            </div>
          )}

          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="email" className="sr-only">
                {t.login.emailLabel}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder={t.login.emailPlaceholder}
                value={email}
                onChange={(e) => { clearError(); setSuccessMessage(null); setEmail(e.target.value); }}
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                {t.login.passwordLabel}
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder={t.login.passwordPlaceholder}
                value={password}
                onChange={(e) => { clearError(); setSuccessMessage(null); setPassword(e.target.value); }}
              />
            </div>
          </div>

          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => { clearError(); setSuccessMessage(null); setMode('forgotPassword'); }}
              className="text-sm text-indigo-600 hover:text-indigo-500"
            >
              {t.login.forgotPassword}
            </button>
          </div>

          <div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? t.login.signingIn : t.login.signIn}
            </button>
          </div>

          <div className="text-center">
            <span className="text-sm text-gray-600">{t.login.noAccount} </span>
            <Link
              to="/register"
              className="text-sm text-indigo-600 hover:text-indigo-500 font-medium"
            >
              {t.login.requestAccess}
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
