import { supabase } from '../utils/supabaseClient.js';
import { formatLocalDate } from './attendanceSettingsService.js';

const holidayCache = new Map();
const getTodayKey = () => formatLocalDate(new Date());

const syncHolidayCache = (date, holiday) => {
    if (!date) {
        return;
    }

    if (date === getTodayKey()) {
        holidayCache.set(date, holiday);
        return;
    }

    holidayCache.delete(date);
};

const clearHolidayCache = (date = null) => {
    if (date) {
        holidayCache.delete(date);
        return;
    }

    holidayCache.clear();
};

export const isHoliday = async (date = new Date()) => {
    const targetDate = typeof date === 'string' ? date : formatLocalDate(date);
    
    // Check cache (valid for the current day)
    const today = getTodayKey();
    if (targetDate === today && holidayCache.has(targetDate)) {
        return holidayCache.get(targetDate);
    }

    const { data, error } = await supabase
        .from('academic_calendar')
        .select('id, reason, is_holiday')
        .eq('date', targetDate)
        .eq('is_holiday', true)
        .maybeSingle();

    if (error) {
        const isMissingTable = error.message?.includes('academic_calendar');
        if (isMissingTable || error.message?.includes('fetch failed')) {
            return { isHoliday: false, reason: null };
        }
        throw new Error(error.message);
    }

    const result = {
        isHoliday: Boolean(data),
        reason: data?.reason || null
    };

    // Cache if it's for today
    if (targetDate === today) {
        syncHolidayCache(targetDate, result);
    }

    return result;
};

export const getHolidays = async ({ fromDate = null, toDate = null } = {}) => {
    let query = supabase
        .from('academic_calendar')
        .select('*')
        .order('date', { ascending: true });

    if (fromDate) {
        query = query.gte('date', fromDate);
    }

    if (toDate) {
        query = query.lte('date', toDate);
    }

    const { data, error } = await query;

    if (error) {
        const isMissingTable = error.message?.includes('academic_calendar');
        if (isMissingTable) {
            return [];
        }
        throw new Error(error.message);
    }

    return data || [];
};

export const addHoliday = async ({ date, reason, isHoliday = true }) => {
    const { data, error } = await supabase
        .from('academic_calendar')
        .upsert([{ date, reason, is_holiday: isHoliday }], { onConflict: 'date' })
        .select()
        .single();

    if (error) {
        throw new Error(error.message);
    }

    syncHolidayCache(data?.date, {
        isHoliday: Boolean(data?.is_holiday),
        reason: data?.reason || null
    });

    return data;
};

export const deleteHoliday = async (holidayId) => {
    const { data, error } = await supabase
        .from('academic_calendar')
        .delete()
        .eq('id', holidayId)
        .select('date')
        .maybeSingle();

    if (error) {
        throw new Error(error.message);
    }

    if (data?.date) {
        clearHolidayCache(data.date);
    } else {
        clearHolidayCache();
    }
};
