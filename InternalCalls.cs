using System;
using System.Runtime.CompilerServices;

namespace Mono.WebAssembly.JSInterop
{
    internal static class InternalCalls
    {
        [MethodImplAttribute(MethodImplOptions.InternalCall)]
        internal static extern string InvokeJS(string str, out int exceptional_result);

        [MethodImplAttribute(MethodImplOptions.InternalCall)]
        internal static extern object InvokeJSWithArgs(int js_obj_handle, string method, object[] _params, bool is_managed, out int exceptional_result);

        // We're passing asyncHandle by ref not because we want it to be writable, but so it gets
        // passed as a pointer (4 bytes). We can pass 4-byte values, but not 8-byte ones.
        [MethodImpl(MethodImplOptions.InternalCall)]
        public static extern string InvokeJSMarshalled(out string exception, ref long asyncHandle, string functionIdentifier, string argsJson);

        [MethodImpl(MethodImplOptions.InternalCall)]
        public static extern TRes InvokeJSUnmarshalled<T0, T1, T2, TRes>(out string exception, string functionIdentifier, T0 arg0, T1 arg1, T2 arg2);

        [MethodImplAttribute(MethodImplOptions.InternalCall)]
        internal static extern object GetJSGlobal(string global, bool is_managed, out int exceptional_result);

        [MethodImplAttribute(MethodImplOptions.InternalCall)]
        internal static extern object GetJSProperty(int js_obj_handle, string method, bool is_managed, out int exceptional_result);

        [MethodImplAttribute(MethodImplOptions.InternalCall)]
        internal static extern object SetJSProperty(int js_obj_handle, string method, object value, bool createIfNotExists, bool hasOwnProperty, bool is_managed, out int exceptional_result);

        [MethodImplAttribute(MethodImplOptions.InternalCall)]
        internal static extern object GetJSStyleAttribute(int js_obj_handle, string attribute, out int exceptional_result);

        [MethodImplAttribute(MethodImplOptions.InternalCall)]
        internal static extern object SetJSStyleAttribute(int js_obj_handle, string attribute, string newValue, out int exceptional_result);

        [MethodImplAttribute(MethodImplOptions.InternalCall)]
        internal static extern object AddJSEventListener(int js_obj_handle, string eventType, object eventDelegate, int eventUID, out int exceptional_result);

    }
}
