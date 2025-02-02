import { useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';

import useStorageService from '@/services/useStorageService';

import { DEFAULT_SYSTEM_PROMPT } from '@/utils/app/const';
import { getSettings } from '@/utils/app/settings';

import { Conversation } from '@/types/chat';
import { KeyValuePair } from '@/types/data';
import { OpenAIModels } from '@/types/openai';

import HomeContext from '@/pages/api/home/home.context';

import { v4 as uuidv4 } from 'uuid';

type ConversationsAction = {
  update: (newState: Conversation) => Promise<Conversation[]>;
  updateValue: (
    conversation: Conversation,
    kv: KeyValuePair,
  ) => Promise<Conversation[]>;
  updateAll: (newState: Conversation[]) => Promise<Conversation[]>;
  add: () => Promise<Conversation[]>;
  clear: () => Promise<Conversation[]>;
  remove: (conversation: Conversation) => Promise<Conversation[]>;
};

export default function useConversations(): [
  Conversation[],
  ConversationsAction,
] {
  const { t } = useTranslation('chat');
  const { t: tErr } = useTranslation('error');
  const storageService = useStorageService();
  const {
    state: { defaultModelId, conversations, selectedConversation },
    dispatch,
  } = useContext(HomeContext);

  const updateAll = useCallback(
    async (updated: Conversation[]): Promise<Conversation[]> => {
      await storageService.saveConversations(updated);
      dispatch({ field: 'conversations', value: updated });
      return updated;
    },
    [dispatch, storageService],
  );

  const add = useCallback(async () => {
    if (!defaultModelId) {
      throw new Error('No default model');
    }

    const lastConversation = conversations[conversations.length - 1];
    const settings = getSettings();

    const newConversation: Conversation = {
      id: uuidv4(),
      name: `${t('New Conversation')}`,
      messages: [],
      model: lastConversation?.model || {
        id: OpenAIModels[defaultModelId].id,
        name: OpenAIModels[defaultModelId].name,
        maxLength: OpenAIModels[defaultModelId].maxLength,
        tokenLimit: OpenAIModels[defaultModelId].tokenLimit,
      },
      prompt: DEFAULT_SYSTEM_PROMPT,
      temperature: settings.defaultTemperature,
      folderId: null,
    };

    const updatedConversations = await updateAll([
      ...conversations,
      newConversation,
    ]);
    await storageService.saveSelectedConversation(newConversation);
    dispatch({ field: 'selectedConversation', value: newConversation });
    dispatch({ field: 'loading', value: false });
    return updatedConversations;
  }, [conversations, defaultModelId, dispatch, storageService, t, updateAll]);

  const update = useCallback(
    async (conversation: Conversation) => {
      const newState = conversations.map((f) => {
        if (f.id === conversation.id) {
          return conversation;
        }
        return f;
      });
      return updateAll(newState);
    },
    [conversations, updateAll],
  );

  const updateValue = useCallback(
    async (conversation: Conversation, kv: KeyValuePair) => {
      const updatedConversation = {
        ...conversation,
        [kv.key]: kv.value,
      };
      const newConversations = await update(updatedConversation);
      if (selectedConversation?.id === conversation.id) {
        storageService.saveSelectedConversation(updatedConversation);
        dispatch({ field: 'selectedConversation', value: updatedConversation });
      }
      return newConversations;
    },
    [dispatch, selectedConversation?.id, storageService, update],
  );

  const remove = useCallback(
    async (conversation: Conversation) => {
      await storageService.removeConversation(conversation.id);
      const updatedConversations = conversations.filter(
        (c) => c.id !== conversation.id,
      );
      dispatch({ field: 'conversations', value: updatedConversations });
      return updatedConversations;
    },
    [conversations, dispatch, storageService],
  );

  const clear = useCallback(async () => {
    await storageService.removeAllConversations();
    dispatch({ field: 'conversations', value: [] });
    return [];
  }, [dispatch, storageService]);

  return [
    conversations,
    {
      add,
      update,
      updateValue,
      updateAll,
      remove,
      clear,
    },
  ];
}
