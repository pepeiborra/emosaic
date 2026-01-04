import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getCaptcha, submitRegistration } from '../services/api';
import { useTranslation } from '../i18n';

export function Register() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [captchaId, setCaptchaId] = useState('');
  const [captchaQuestion, setCaptchaQuestion] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingCaptcha, setIsLoadingCaptcha] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const t = useTranslation();

  const loadCaptcha = useCallback(async () => {
    setIsLoadingCaptcha(true);
    setError(null);
    try {
      const captcha = await getCaptcha();
      setCaptchaId(captcha.id);
      setCaptchaQuestion(captcha.question);
      setCaptchaAnswer('');
    } catch (err) {
      setError(t.register.captchaLoadError);
    } finally {
      setIsLoadingCaptcha(false);
    }
  }, [t]);

  useEffect(() => {
    loadCaptcha();
  }, [loadCaptcha]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await submitRegistration({
        email: email.trim(),
        name: name.trim(),
        captcha_id: captchaId,
        captcha_answer: captchaAnswer.trim(),
      });

      if (result.success) {
        setSuccess(true);
      } else {
        setError(result.error || t.register.submitError);
        // Reload captcha on error
        await loadCaptcha();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.register.submitError);
      // Reload captcha on error
      await loadCaptcha();
    } finally {
      setIsSubmitting(false);
    }
  };

  // Success state
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div>
            <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
              {t.register.successTitle}
            </h2>
            <div className="mt-4 rounded-md bg-green-50 p-4">
              <p className="text-sm text-green-700">
                {t.register.successMessage}
              </p>
            </div>
            <div className="mt-6 text-center">
              <Link
                to="/login"
                className="text-indigo-600 hover:text-indigo-500 font-medium"
              >
                {t.register.backToLogin}
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            {t.register.title}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            {t.register.subtitle}
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                {t.register.nameLabel}
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                autoComplete="name"
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder={t.register.namePlaceholder}
                value={name}
                onChange={(e) => { setError(null); setName(e.target.value); }}
                minLength={2}
                maxLength={100}
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                {t.register.emailLabel}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder={t.register.emailPlaceholder}
                value={email}
                onChange={(e) => { setError(null); setEmail(e.target.value); }}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                {t.register.captchaLabel}
              </label>
              <div className="mt-1 flex items-center space-x-3">
                <div className="flex-grow px-3 py-2 bg-gray-100 border border-gray-300 rounded-md text-lg font-mono text-center">
                  {isLoadingCaptcha ? '...' : captchaQuestion}
                </div>
                <button
                  type="button"
                  onClick={loadCaptcha}
                  disabled={isLoadingCaptcha}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-600 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                  title={t.register.refreshCaptcha}
                >
                  &#8635;
                </button>
              </div>
              <input
                id="captcha"
                name="captcha"
                type="text"
                required
                inputMode="numeric"
                pattern="[0-9]*"
                className="mt-2 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder={t.register.captchaPlaceholder}
                value={captchaAnswer}
                onChange={(e) => { setError(null); setCaptchaAnswer(e.target.value); }}
              />
            </div>
          </div>

          <div className="flex flex-col space-y-3">
            <button
              type="submit"
              disabled={isSubmitting || isLoadingCaptcha || !email || !name || !captchaAnswer}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? t.register.submitting : t.register.submit}
            </button>

            <div className="text-center">
              <Link
                to="/login"
                className="text-sm text-indigo-600 hover:text-indigo-500"
              >
                {t.register.alreadyHaveAccount}
              </Link>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
