import { supabase } from '../supabaseClient.js';

const must = (result, context) => {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data;
};

/** Persistence for devices and notifications (tables: supabase/mobile.sql). */
export const mobileStore = {
  async upsertDevice({ userId, deviceId, platform, pushToken, appVersion, osVersion, enabled }) {
    const now = new Date().toISOString();
    // A token belongs to one install: if it was previously registered to another user on this phone, detach it.
    must(await supabase.from('mobile_devices').delete().eq('push_token', pushToken).neq('user_id', userId), 'detachToken');
    must(
      await supabase.from('mobile_devices').upsert(
        { user_id: userId, device_id: deviceId, platform, push_token: pushToken, app_version: appVersion, os_version: osVersion, enabled, last_seen_at: now },
        { onConflict: 'user_id,device_id' },
      ),
      'upsertDevice',
    );
  },
  async deleteDevice(userId, deviceId) {
    must(await supabase.from('mobile_devices').delete().eq('user_id', userId).eq('device_id', deviceId), 'deleteDevice');
  },
  async listDevices(userId) {
    return must(
      await supabase.from('mobile_devices').select('device_id, platform, app_version, os_version, enabled, created_at, last_seen_at').eq('user_id', userId),
      'listDevices',
    );
  },
  async listEnabledDevices(userId) {
    return must(await supabase.from('mobile_devices').select('device_id, push_token').eq('user_id', userId).eq('enabled', true), 'listEnabledDevices');
  },
  async disableDevice(userId, deviceId) {
    must(await supabase.from('mobile_devices').update({ enabled: false }).eq('user_id', userId).eq('device_id', deviceId), 'disableDevice');
  },
  async hasEnabledDevices(userId) {
    const rows = must(await supabase.from('mobile_devices').select('id').eq('user_id', userId).eq('enabled', true).limit(1), 'hasEnabledDevices');
    return rows.length > 0;
  },
  async insertNotification({ userId, type, title, body, data }) {
    return must(await supabase.from('notifications').insert({ user_id: userId, type, title, body, data }).select('*').single(), 'insertNotification');
  },
  async markSent(id, at) {
    must(await supabase.from('notifications').update({ sent_at: at }).eq('id', id), 'markSent');
  },
  async listNotifications(userId, { limit = 50 } = {}) {
    return must(
      await supabase.from('notifications').select('id, type, title, body, data, created_at, read_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit),
      'listNotifications',
    );
  },
  async markRead(userId, id) {
    must(await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).eq('id', id).is('read_at', null), 'markRead');
  },
  async wasSent(userId, dedupeKey) {
    const rows = must(await supabase.from('notifications').select('id').eq('user_id', userId).eq('data->>dedupeKey', dedupeKey).limit(1), 'wasSent');
    return rows.length > 0;
  },
};
