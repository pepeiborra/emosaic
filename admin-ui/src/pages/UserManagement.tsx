import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listUsers,
  createUser,
  deleteUser,
  resendUserInvite,
  enableUser,
  disableUser,
} from '../services/api';
import { useTranslation } from '../i18n';
import type { User } from '../types/api';

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  );
}

function EnvelopeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
    </svg>
  );
}

function useStatusBadgeClass(status: User['status'], enabled: boolean): string {
  if (!enabled) {
    return 'bg-gray-100 text-gray-800';
  }
  switch (status) {
    case 'CONFIRMED':
      return 'bg-green-100 text-green-800';
    case 'UNCONFIRMED':
    case 'FORCE_CHANGE_PASSWORD':
      return 'bg-yellow-100 text-yellow-800';
    case 'RESET_REQUIRED':
      return 'bg-orange-100 text-orange-800';
    case 'ARCHIVED':
    case 'COMPROMISED':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

function useStatusLabel(status: User['status'], enabled: boolean): string {
  const t = useTranslation();
  if (!enabled) {
    return t.userManagement.statusLabels.disabled;
  }
  switch (status) {
    case 'CONFIRMED':
      return t.userManagement.statusLabels.active;
    case 'UNCONFIRMED':
      return t.userManagement.statusLabels.pending;
    case 'FORCE_CHANGE_PASSWORD':
      return t.userManagement.statusLabels.passwordReset;
    case 'RESET_REQUIRED':
      return t.userManagement.statusLabels.resetRequired;
    case 'ARCHIVED':
      return t.userManagement.statusLabels.archived;
    case 'COMPROMISED':
      return t.userManagement.statusLabels.compromised;
    default:
      return status;
  }
}

export function UserManagement() {
  const queryClient = useQueryClient();
  const t = useTranslation();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: listUsers,
  });

  const createMutation = useMutation({
    mutationFn: (email: string) => createUser(email),
    onSuccess: (result) => {
      if (result.success) {
        setActionSuccess(result.message || t.userManagement.userCreatedSuccess);
        setShowCreateModal(false);
        setNewUserEmail('');
        queryClient.invalidateQueries({ queryKey: ['users'] });
      } else {
        setActionError(result.error || t.userManagement.failedToCreateUser);
      }
    },
    onError: (err: Error) => {
      setActionError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: (result) => {
      if (result.success) {
        setActionSuccess(result.message || t.userManagement.userDeletedSuccess);
        setConfirmDelete(null);
        queryClient.invalidateQueries({ queryKey: ['users'] });
      } else {
        setActionError(result.error || t.userManagement.failedToDeleteUser);
      }
    },
    onError: (err: Error) => {
      setActionError(err.message);
    },
  });

  const resendInviteMutation = useMutation({
    mutationFn: resendUserInvite,
    onSuccess: (result) => {
      if (result.success) {
        setActionSuccess(result.message || t.userManagement.invitationResent);
      } else {
        setActionError(result.error || t.userManagement.failedToResendInvite);
      }
    },
    onError: (err: Error) => {
      setActionError(err.message);
    },
  });

  const enableMutation = useMutation({
    mutationFn: enableUser,
    onSuccess: (result) => {
      if (result.success) {
        setActionSuccess(result.message || t.userManagement.userEnabled);
        queryClient.invalidateQueries({ queryKey: ['users'] });
      } else {
        setActionError(result.error || t.userManagement.failedToEnableUser);
      }
    },
    onError: (err: Error) => {
      setActionError(err.message);
    },
  });

  const disableMutation = useMutation({
    mutationFn: disableUser,
    onSuccess: (result) => {
      if (result.success) {
        setActionSuccess(result.message || t.userManagement.userDisabled);
        queryClient.invalidateQueries({ queryKey: ['users'] });
      } else {
        setActionError(result.error || t.userManagement.failedToDisableUser);
      }
    },
    onError: (err: Error) => {
      setActionError(err.message);
    },
  });

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionSuccess(null);
    if (newUserEmail.trim()) {
      createMutation.mutate(newUserEmail.trim());
    }
  };

  const clearMessages = () => {
    setActionError(null);
    setActionSuccess(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-800">{t.userManagement.errorLoadingUsers}: {(error as Error).message}</p>
      </div>
    );
  }

  const users = data?.users || [];

  return (
    <div>
      {/* Header */}
      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.userManagement.title}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {t.userManagement.subtitle}
          </p>
        </div>
        <button
          onClick={() => {
            clearMessages();
            setShowCreateModal(true);
          }}
          className="mt-4 sm:mt-0 inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          <PlusIcon className="h-5 w-5 mr-2" />
          {t.userManagement.addUser}
        </button>
      </div>

      {/* Success/Error Messages */}
      {actionSuccess && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-4 flex justify-between items-center">
          <p className="text-green-800">{actionSuccess}</p>
          <button onClick={() => setActionSuccess(null)} className="text-green-600 hover:text-green-800">
            &times;
          </button>
        </div>
      )}

      {actionError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4 flex justify-between items-center">
          <p className="text-red-800">{actionError}</p>
          <button onClick={() => setActionError(null)} className="text-red-600 hover:text-red-800">
            &times;
          </button>
        </div>
      )}

      {/* Users List */}
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        {users.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            <UserIcon className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-2">{t.userManagement.noUsersFound}</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {users.map((user) => (
              <UserRow
                key={user.username}
                user={user}
                onResendInvite={() => {
                  clearMessages();
                  resendInviteMutation.mutate(user.email || user.username);
                }}
                onEnable={() => {
                  clearMessages();
                  enableMutation.mutate(user.email || user.username);
                }}
                onDisable={() => {
                  clearMessages();
                  disableMutation.mutate(user.email || user.username);
                }}
                onDelete={() => {
                  clearMessages();
                  setConfirmDelete(user.email || user.username);
                }}
                isResending={resendInviteMutation.isPending}
                isEnabling={enableMutation.isPending}
                isDisabling={disableMutation.isPending}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            <div
              className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
              onClick={() => setShowCreateModal(false)}
            />

            <div className="relative inline-block bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:max-w-lg sm:w-full sm:p-6">
              <form onSubmit={handleCreateUser}>
                <div>
                  <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-indigo-100">
                    <UserIcon className="h-6 w-6 text-indigo-600" />
                  </div>
                  <div className="mt-3 text-center sm:mt-5">
                    <h3 className="text-lg leading-6 font-medium text-gray-900">{t.userManagement.addNewUser}</h3>
                    <p className="mt-2 text-sm text-gray-500">
                      {t.userManagement.newUserInstructions}
                    </p>
                  </div>
                </div>

                <div className="mt-5">
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                    {t.userManagement.emailAddressLabel}
                  </label>
                  <input
                    type="email"
                    id="email"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    required
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    placeholder={t.userManagement.emailPlaceholder}
                  />
                </div>

                <div className="mt-5 sm:mt-6 sm:flex sm:flex-row-reverse gap-3">
                  <button
                    type="submit"
                    disabled={createMutation.isPending || !newUserEmail.trim()}
                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:w-auto sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {createMutation.isPending ? t.userManagement.creatingUser : t.userManagement.createUser}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateModal(false);
                      setNewUserEmail('');
                    }}
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:w-auto sm:text-sm"
                  >
                    {t.common.cancel}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            <div
              className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
              onClick={() => setConfirmDelete(null)}
            />

            <div className="relative inline-block bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:max-w-lg sm:w-full sm:p-6">
              <div>
                <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
                  <TrashIcon className="h-6 w-6 text-red-600" />
                </div>
                <div className="mt-3 text-center sm:mt-5">
                  <h3 className="text-lg leading-6 font-medium text-gray-900">{t.userManagement.deleteUser}</h3>
                  <p className="mt-2 text-sm text-gray-500">
                    {t.userManagement.deleteUserConfirmation} <span className="font-medium">{confirmDelete}</span>? {t.userManagement.cannotBeUndone}
                  </p>
                </div>
              </div>

              <div className="mt-5 sm:mt-6 sm:flex sm:flex-row-reverse gap-3">
                <button
                  type="button"
                  onClick={() => {
                    deleteMutation.mutate(confirmDelete);
                  }}
                  disabled={deleteMutation.isPending}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:w-auto sm:text-sm disabled:opacity-50"
                >
                  {deleteMutation.isPending ? t.common.deleting : t.common.delete}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(null)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:w-auto sm:text-sm"
                >
                  {t.common.cancel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UserRow({
  user,
  onResendInvite,
  onEnable,
  onDisable,
  onDelete,
  isResending,
  isEnabling,
  isDisabling,
}: {
  user: User;
  onResendInvite: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onDelete: () => void;
  isResending: boolean;
  isEnabling: boolean;
  isDisabling: boolean;
}) {
  const t = useTranslation();
  const badgeClass = useStatusBadgeClass(user.status, user.enabled);
  const statusLabel = useStatusLabel(user.status, user.enabled);

  return (
    <li className="p-4 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center min-w-0 flex-1">
          <div className="flex-shrink-0">
            <div className="h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center">
              <UserIcon className="h-6 w-6 text-indigo-600" />
            </div>
          </div>
          <div className="ml-4 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {user.email || user.username}
            </p>
            <p className="text-sm text-gray-500">
              {t.userManagement.createdLabel}: {user.created ? new Date(user.created).toLocaleDateString() : 'N/A'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badgeClass}`}
          >
            {statusLabel}
          </span>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {/* Resend invite (only for unconfirmed users) */}
            {(user.status === 'UNCONFIRMED' || user.status === 'FORCE_CHANGE_PASSWORD') && (
              <button
                onClick={onResendInvite}
                disabled={isResending}
                className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                title={t.userManagement.resendInvite}
              >
                <EnvelopeIcon className="h-5 w-5" />
              </button>
            )}

            {/* Enable/Disable toggle */}
            {user.enabled ? (
              <button
                onClick={onDisable}
                disabled={isDisabling}
                className="px-3 py-1 text-xs font-medium text-orange-700 bg-orange-100 hover:bg-orange-200 rounded-md transition-colors"
              >
                {t.common.disable}
              </button>
            ) : (
              <button
                onClick={onEnable}
                disabled={isEnabling}
                className="px-3 py-1 text-xs font-medium text-green-700 bg-green-100 hover:bg-green-200 rounded-md transition-colors"
              >
                {t.common.enable}
              </button>
            )}

            {/* Delete button */}
            <button
              onClick={onDelete}
              className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
              title={t.common.delete}
            >
              <TrashIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
