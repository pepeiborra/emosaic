import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hub } from 'aws-amplify/utils';
import { getCurrentUser } from 'aws-amplify/auth';
import { useTranslation } from '../i18n';

export function Callback() {
  const navigate = useNavigate();
  const t = useTranslation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If we're already signed in (e.g. Amplify finished the code exchange
    // before this component mounted) just navigate home.
    getCurrentUser()
      .then(() => navigate('/', { replace: true }))
      .catch(() => {
        // Not yet signed in; wait for Hub events from the redirect flow.
      });

    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      switch (payload.event) {
        case 'signedIn':
          navigate('/', { replace: true });
          break;
        case 'signInWithRedirect_failure': {
          const message =
            (payload as { data?: { error?: { message?: string } } }).data?.error?.message ||
            t.callback.failed;
          setError(message);
          break;
        }
      }
    });

    return unsubscribe;
  }, [navigate, t]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="rounded-md bg-red-50 p-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="text-sm text-indigo-600 hover:text-indigo-500"
          >
            {t.callback.backToLogin}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="text-center space-y-3">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
        <p className="text-sm text-gray-600">{t.callback.signingIn}</p>
      </div>
    </div>
  );
}
