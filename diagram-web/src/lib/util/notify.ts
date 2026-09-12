import { toast, type ExternalToast } from 'svelte-sonner';

export const notify = (message: string, options?: ExternalToast): void => {
  toast(message, options);
};

export const prompt = (message: string): boolean => {
  return confirm(message);
};
