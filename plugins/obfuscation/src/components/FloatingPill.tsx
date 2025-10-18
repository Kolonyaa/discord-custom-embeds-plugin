import { React } from "@vendetta/metro/common";
import { ReactNative as RN } from "@vendetta/metro/common";
import { stylesheet } from "@vendetta/metro/common";
import { semanticColors } from "@vendetta/ui";
import { useProxy } from "@vendetta/storage";
import { FluxDispatcher } from "@vendetta/metro/common";
import { findByStoreName } from "@vendetta/metro";
import { vstorage } from "../storage";

const MessageStore = findByStoreName("MessageStore");

const styles = stylesheet.createThemedStyleSheet({
    androidRipple: {
        color: semanticColors.ANDROID_RIPPLE,
        cornerRadius: 8,
    } as any,
    container: {
        backgroundColor: "transparent",
        borderRadius: 8,
        marginRight: 8,
        marginTop: -12,
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-end",
    },
    text: {
        color: semanticColors.TEXT_NORMAL,
        fontSize: 12,
        fontWeight: "600",
        paddingHorizontal: 8,
        paddingVertical: 8,
    },
    enabled: {
        color: semanticColors.TEXT_POSITIVE,
    },
    disabled: {
        color: semanticColors.TEXT_MUTED,
    },
});

export default function FloatingPill() {
    useProxy(vstorage);

    const reprocessAllMessages = () => {
        console.log("[ObfuscationPlugin] Reprocessing affected messages after toggle...");

        const channels = MessageStore.getMutableMessages?.() ?? {};

        Object.entries(channels).forEach(([channelId, channelMessages]: [string, any]) => {
            if (channelMessages && typeof channelMessages === 'object') {
                Object.values(channelMessages).forEach((message: any) => {
                    // Only process messages that have our marker OR that we might have decrypted
                    if (message?.content && (
                        message.content.includes(`[🔐${vstorage.marker}]`) ||
                        message.content.includes(`[🔓${vstorage.marker}]`)
                    )) {
                        FluxDispatcher.dispatch({
                            type: "MESSAGE_UPDATE",
                            message: { ...message },
                            log_edit: false,
                        });
                    }
                });
            }
        });
    };

    const handleToggle = () => {
        const wasEnabled = vstorage.enabled;
        vstorage.enabled = !vstorage.enabled;

        // Reprocess messages after a short delay to ensure state is updated
        setTimeout(reprocessAllMessages, 100);
    };

    return (
        <RN.Pressable
            android_ripple={styles.androidRipple}
            style={styles.container}
            onPress={handleToggle}
        >
            <RN.Text style={[styles.text, vstorage.enabled ? styles.enabled : styles.disabled]}>
                {vstorage.enabled ? "🔐 ON" : "🔓 OFF"}
            </RN.Text>
        </RN.Pressable>
    );
}