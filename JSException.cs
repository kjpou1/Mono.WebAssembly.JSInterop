using System;
namespace Mono.WebAssembly.JSInterop
{
    public class JSException : Exception
    {
        public JSException(string msg) : base(msg) { }
    }

}
