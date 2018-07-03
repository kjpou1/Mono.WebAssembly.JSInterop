using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Reflection;

namespace Mono.WebAssembly.JSInterop
{
    public class JSObject : IJSObject, IDisposable
    {
        public int JSHandle;
        public GCHandle Handle;
        internal object RawObject;

        // Flag: Has Dispose already been called?
        bool disposed = false;

        public JSObject(int js_handle)
        {
            this.JSHandle = js_handle;
            this.Handle = GCHandle.Alloc(this);
        }

        internal JSObject(int js_id, object raw_obj)
        {

            this.JSHandle = js_id;
            this.Handle = GCHandle.Alloc(this);
            this.RawObject = raw_obj;
        }

        public object Invoke(string method, params object[] args)
        {
            int exception = 0;
            var res = InternalCalls.InvokeJSWithArgs(JSHandle, method, args, false, out exception);
            if (exception != 0)
                throw new JSException((string)res);
            return res;
        }

        public object Invoke(string method, bool isClrManaged, params object[] args)
        {
            int exception = 0;
            var res = InternalCalls.InvokeJSWithArgs(JSHandle, method, args, isClrManaged, out exception);
            if (exception != 0)
                throw new JSException((string)res);
            return res;
        }

        public int BindObject()
        {
            return JSInterop.BindJSObject(this);
        }


        public JSObject(string globalName) : this(GetJSGlobal(globalName))
        {
            
        }

        static int GetJSGlobal(string str)
        {
            int exception = 0;
            var globalHandle = InternalCalls.GetJSGlobal(str, true, out exception);

            if (exception != 0)
                throw new JSException($"Error obtaining a handle to global {str}");

            return (int)globalHandle;
        }

        public object GetJSProperty(string expr, bool isClrManaged = true)
        {

            int exception = 0;
            var propertyValue = InternalCalls.GetJSProperty(JSHandle, expr, isClrManaged, out exception);

            if (exception != 0)
                throw new JSException((string)propertyValue);

            return propertyValue;

        }

        public void SetJSProperty(string expr, object value, bool createIfNotExists = true, bool hasOwnProperty = false, bool isClrManaged = true)
        {

            int exception = 0;
            var setPropResult = InternalCalls.SetJSProperty(JSHandle, expr, value, createIfNotExists, hasOwnProperty, isClrManaged, out exception);
            if (exception != 0)
                throw new JSException($"Error setting {expr} on jsobect {JSHandle}");

        }

        public object GetJSStyleAttribute(string attributeName)
        {

            int exception = 0;
            var attribute = InternalCalls.GetJSStyleAttribute(JSHandle, attributeName, out exception);

            if (exception != 0)
                throw new JSException((string)attribute);

            return attribute;

        }

        public void SetJSStyleAttribute(string attributeName, string value)
        {

            int exception = 0;
            var res = InternalCalls.SetJSStyleAttribute(JSHandle, attributeName, value == null ? value : value.ToString(), out exception);

            if (exception != 0)
                throw new JSException((string)res);

        }

        public void AddJSEventListener(string eventName, object eventDelegate, int uid)
        {

            int exception = 0;
            var res = InternalCalls.AddJSEventListener(JSHandle, eventName, eventDelegate, uid, out exception);

            if (exception != 0)
                throw new JSException((string)res);

        }

        protected void FreeHandle()
        {

#if DEBUG
            Console.WriteLine($"CS::Mono.WebAssembly.Runtime::FreeHandle {JSHandle}");
#endif
            JSInterop.InvokeJS("BINDING.mono_wasm_free_handle(" + JSHandle + ");");
        }


        public override bool Equals(System.Object obj)
        {
            if (obj == null || GetType() != obj.GetType())
            {
                return false;
            }
            return JSHandle == (obj as JSObject).JSHandle;
        }

        public override int GetHashCode()
        {
            return JSHandle;
        }

        public void Dispose()
        {
            // Dispose of unmanaged resources.
            Dispose(true);
            // Suppress finalization.
            GC.SuppressFinalize(this);
        }

        // Protected implementation of Dispose pattern.
        protected virtual void Dispose(bool disposing)
        {
            if (disposed)
                return;

            if (disposing)
            {

                // Free any other managed objects here.
                //
            }

            // Free any unmanaged objects here.
            //
            FreeHandle();

            disposed = true;
        }


        public override string ToString()
        {
            return $"(js-obj js '{JSHandle}' mono '{(IntPtr)Handle} raw '{RawObject != null})";
        }
    }}


