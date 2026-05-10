import { Amplify } from 'aws-amplify';

const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN as string | undefined;

const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
      signUpVerificationMethod: 'code' as const,
      // OAuth is only configured when the Cognito Hosted UI domain is known.
      // Amplify picks the matching redirect URL from each list based on the
      // current window origin, so both prod and localhost work from one build.
      ...(cognitoDomain
        ? {
            loginWith: {
              oauth: {
                domain: cognitoDomain,
                scopes: ['openid', 'email', 'profile'],
                redirectSignIn: [
                  'https://casadelmanco.com/admin/callback',
                  'http://localhost:5173/callback',
                ],
                redirectSignOut: [
                  'https://casadelmanco.com/admin',
                  'http://localhost:5173',
                ],
                responseType: 'code' as const,
              },
            },
          }
        : {}),
    },
  },
};

export function configureAmplify() {
  Amplify.configure(amplifyConfig);
}

export default amplifyConfig;
