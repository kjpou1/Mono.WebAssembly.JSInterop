
var BindingSupportLib = {
	$BINDING__postset: 'BINDING.export_functions (Module);',
	$BINDING: {
		BINDING_ASM: "binding_tests",
		mono_wasm_object_registry: [],
		mono_wasm_ref_counter: 0,
		mono_wasm_free_list: [],
		mono_wasm_marshal_enum_as_int: false,	

		mono_bindings_init: function (binding_asm) {
			this.BINDING_ASM = binding_asm;
		},

		export_functions: function (module) {
			module ["mono_bindings_init"] = BINDING.mono_bindings_init.bind(BINDING);
			module ["mono_method_invoke"] = BINDING.call_method.bind(BINDING);
			module ["mono_method_get_call_signature"] = BINDING.mono_method_get_call_signature.bind(BINDING);
			module ["mono_method_resolve"] = BINDING.resolve_method_fqn.bind(BINDING);
			module ["mono_bind_static_method"] = BINDING.bind_static_method.bind(BINDING);
			module ["mono_call_static_method"] = BINDING.call_static_method.bind(BINDING);
		},

		bindings_lazy_init: function () {
			if (this.init)
				return;
		
			this.assembly_load = Module.cwrap ('mono_wasm_assembly_load', 'number', ['string']);
			this.find_class = Module.cwrap ('mono_wasm_assembly_find_class', 'number', ['number', 'string', 'string']);
			this.find_method = Module.cwrap ('mono_wasm_assembly_find_method', 'number', ['number', 'string', 'number']);
			this.invoke_method = Module.cwrap ('mono_wasm_invoke_method', 'number', ['number', 'number', 'number']);
			this.mono_string_get_utf8 = Module.cwrap ('mono_wasm_string_get_utf8', 'number', ['number']);
			this.js_string_to_mono_string = Module.cwrap ('mono_wasm_string_from_js', 'number', ['string']);
			this.mono_get_obj_type = Module.cwrap ('mono_wasm_get_obj_type', 'number', ['number']);
			this.mono_unbox_int = Module.cwrap ('mono_unbox_int', 'number', ['number']);
			this.mono_unbox_float = Module.cwrap ('mono_wasm_unbox_float', 'number', ['number']);
			this.mono_array_length = Module.cwrap ('mono_wasm_array_length', 'number', ['number']);
			this.mono_array_get = Module.cwrap ('mono_wasm_array_get', 'number', ['number', 'number']);
			this.mono_obj_array_new = Module.cwrap ('mono_wasm_obj_array_new', 'number', ['number']);
			this.mono_obj_array_set = Module.cwrap ('mono_wasm_obj_array_set', 'void', ['number', 'number', 'number']);
			this.mono_wasm_get_enum_type_name = Module.cwrap('mono_wasm_get_enum_type_name', 'string' ['number'])
			this.mono_unbox_enum = Module.cwrap ('mono_unbox_enum', 'number', ['number']);

			this.binding_module = this.assembly_load (this.BINDING_ASM);
			var wasm_runtime_class = this.find_class (this.binding_module, "Mono.WebAssembly.JSInterop", "JSInterop")
			if (!wasm_runtime_class)
				throw "Can't find Mono.WebAssembly.JSInterop class";

			var get_method = function(method_name) {
				var res = BINDING.find_method (wasm_runtime_class, method_name, -1)
				if (!res)
					throw "Can't find method Mono.WebAssembly.JSInterop:" + method_name;
				return res;
			}
			this.bind_js_obj = get_method ("BindJSObject");
			this.bind_existing_obj = get_method ("BindExistingObject");
			this.unbind_js_obj = get_method ("UnBindJSObject");
			this.unbind_js_obj_and_fee = get_method ("UnBindJSObjectAndFree");
			this.get_js_id = get_method ("GetJSObjectId");
			this.get_raw_mono_obj = get_method ("GetMonoObject");

			this.box_js_int = get_method ("BoxInt");
			this.box_js_double = get_method ("BoxDouble");
			this.box_js_bool = get_method ("BoxBool");
			this.setup_js_cont = get_method ("SetupJSContinuation");

			this.create_tcs = get_method ("CreateTaskSource");
			this.set_tcs_result = get_method ("SetTaskSourceResult");
			this.set_tcs_failure = get_method ("SetTaskSourceFailure");
			this.tcs_get_task_and_bind = get_method ("GetTaskAndBind");
			this.get_call_sig = get_method ("GetCallSignature");

			this.object_to_string = get_method ("ObjectToString");			

			this.init = true;
		},		
		//FIXME this is wastefull, we could remove the temp malloc by going the UTF16 route
		//FIXME this is unsafe, cuz raw objects could be GC'd.
		conv_string: function (mono_obj) {
			if (mono_obj == 0)
				return null;
			var raw = this.mono_string_get_utf8 (mono_obj);
			var res = Module.UTF8ToString (raw);
			Module._free (raw);

			return res;
		},
		
		mono_array_to_js_array: function (mono_array) {
			if (mono_array == 0)
				return null;

			var res = [];
			var len = this.mono_array_length (mono_array);
			for (var i = 0; i < len; ++i)
				res.push (this.unbox_mono_obj (this.mono_array_get (mono_array, i)));

			return res;
		},

		js_array_to_mono_array: function (js_array) {
			var mono_array = this.mono_obj_array_new (js_array.length);
			for (var i = 0; i < js_array.length; ++i) {
				this.mono_obj_array_set (mono_array, i, this.js_to_mono_obj (js_array [i]));
			}
			return mono_array;
		},

		unbox_mono_obj: function (mono_obj) {
			if (mono_obj == 0)
				return undefined;
			var type = this.mono_get_obj_type (mono_obj);
			//See MARSHAL_TYPE_ defines in driver.c
			switch (type) {
			case 1: // int
				return this.mono_unbox_int (mono_obj);
			case 2: // float
				return this.mono_unbox_float (mono_obj);
			case 3: //string
				return this.conv_string (mono_obj);
			case 4: //vts
				throw new Error ("no idea on how to unbox value types");
			case 5: { // delegate
				var obj = this.extract_js_obj (mono_obj);
				return function () {
					return BINDING.invoke_delegate (obj, arguments);
				};
			}
			case 6: {// Task
				var obj = this.extract_js_obj (mono_obj);
				var cont_obj = null;
				var promise = new Promise (function (resolve, reject) {
					cont_obj = {
						resolve: resolve,
						reject: reject
					};
				});

				this.call_method (this.setup_js_cont, null, "mo", [ mono_obj, cont_obj ]);
				return promise;
			}

			case 7: // ref type
				return this.extract_js_obj (mono_obj);

			case 8: // bool
				return this.mono_unbox_int (mono_obj) != 0;

			case 9: // enum

				if(this.mono_wasm_marshal_enum_as_int)
				{
					return this.mono_unbox_enum (mono_obj);
				}
				else
				{
					enumValue = this.call_method(this.object_to_string, null, "m", [ mono_obj ]);
				}

				return enumValue;

			default:
				throw new Error ("no idea on how to unbox object kind " + type);
			}
		},

		create_task_completion_source: function () {
			return this.call_method (this.create_tcs, null, "", []);
		},

		set_task_result: function (tcs, result) {
			this.call_method (this.set_tcs_result, null, "oo", [ tcs, result ]);
		},

		set_task_failure: function (tcs, reason) {
			this.call_method (this.set_tcs_failure, null, "os", [ tcs, reason.toString () ]);
		},

		js_to_mono_obj: function (js_obj, is_managed) {
	  		this.bindings_lazy_init ();
			
			if (js_obj === null || typeof js_obj == "undefined")
				return 0;

			if (is_managed === null || typeof is_managed == "undefined")
				is_managed = false;
  
			  if (typeof js_obj == 'number') {
				if (parseInt(js_obj) == js_obj)
					return this.call_method (this.box_js_int, null, "im", [ js_obj ]);
				return this.call_method (this.box_js_double, null, "dm", [ js_obj ]);
			}
			if (typeof js_obj == 'string')
				return this.js_string_to_mono_string (js_obj);

			if (typeof js_obj == 'boolean')
				return this.call_method (this.box_js_bool, null, "im", [ js_obj ]);

			if (Promise.resolve(js_obj) === js_obj) {
				var the_task = this.try_extract_mono_obj (js_obj);
				if (the_task)
					return the_task;
				var tcs = this.create_task_completion_source ();
				//FIXME dispose the TCS once the promise completes
				js_obj.then (function (result) {
					BINDING.set_task_result (tcs, result);
				}, function (reason) {
					BINDING.set_task_failure (tcs, reason);
				})

				return this.get_task_and_bind (tcs, js_obj);
			}

			return this.extract_mono_obj (js_obj, is_managed);
		},

		wasm_binding_obj_new: function (js_obj_id)
		{
			return this.call_method (this.bind_js_obj, null, "i", [js_obj_id]);
		},

		wasm_bind_existing: function (mono_obj, js_id)
		{
			return this.call_method (this.bind_existing_obj, null, "mi", [mono_obj, js_id]);
		},

		wasm_unbinding_js_obj: function (js_obj_id)
		{
			return this.call_method (this.unbind_js_obj, null, "i", [js_obj_id]);
		},		

		wasm_unbinding_js_obj_and_free: function (js_obj_id)
		{
			return this.call_method (this.unbind_js_obj_and_fee, null, "i", [js_obj_id]);
		},		

		wasm_get_js_id: function (mono_obj)
		{
			return this.call_method (this.get_js_id, null, "m", [mono_obj]);
		},

		wasm_get_raw_obj: function (gchandle)
		{
			return this.call_method (this.get_raw_mono_obj, null, "im", [gchandle]);
		},

		try_extract_mono_obj:function (js_obj) {
			if (js_obj === null || typeof js_obj === "undefined" || !js_obj.__mono_gchandle__)
				return 0;
			return this.wasm_get_raw_obj (js_obj.__mono_gchandle__);
		},

		mono_method_get_call_signature: function(method) {
			this.bindings_lazy_init ();

			return this.call_method (this.get_call_sig, null, "i", [ method ]);
		},

		get_task_and_bind: function (tcs, js_obj) {
			var task_gchandle = this.call_method (this.tcs_get_task_and_bind, null, "oi", [ tcs, this.mono_wasm_object_registry.length + 1 ]);
			js_obj.__mono_gchandle__ = task_gchandle;
			this.mono_wasm_register_obj (js_obj);
			return this.wasm_get_raw_obj (js_obj.__mono_gchandle__);
		},

		extract_mono_obj: function (js_obj, is_managed) {
			//halp JS ppl, is this enough?
			if (js_obj === null || typeof js_obj === "undefined")
				return 0;

			if (is_managed === null || typeof is_managed === "undefined")
				is_managed = false;
			
			if (is_managed || js_obj.is_clr_managed)
				return this.call_method (this.box_js_int, null, "im", [ this.mono_wasm_register_obj(js_obj, true) ]);

			if (!js_obj.__mono_gchandle__) {
				this.mono_wasm_register_obj(js_obj, false);
			}

			return this.wasm_get_raw_obj (js_obj.__mono_gchandle__);
		},

		extract_js_obj: function (mono_obj) {
			if (mono_obj === 0)
				return null;

			var js_id = this.wasm_get_js_id (mono_obj);
			if (js_id > 0)
				return this.mono_wasm_require_handle(js_id);

			var gcHandle = this.mono_wasm_free_list.length ? this.mono_wasm_free_list.pop() : this.mono_wasm_ref_counter++;
			var js_obj = {
				__mono_gchandle__: this.wasm_bind_existing(mono_obj, gcHandle + 1),
				is_mono_bridged_obj: true
			};

			this.mono_wasm_object_registry[gcHandle] = js_obj;

			return js_obj;
		},

		/*
		args_marshal is a string with one character per parameter that tells how to marshal it, here are the valid values:

		i: int32
		l: int64
		f: float
		d: double
		s: string
		o: js object will be converted to a C# object (this will box numbers/bool/promises)
		m: raw mono object. Don't use it unless you know what you're doing

		additionally you can append 'm' to args_marshal beyond `args.length` if you don't want the return value marshaled
		*/
		call_method: function (method, this_arg, args_marshal, args) {
			this.bindings_lazy_init ();

			var extra_args_mem = 0;
			for (var i = 0; i < args.length; ++i) {
				//long/double memory must be 8 bytes aligned and I'm being lazy here
				if (args_marshal[i] == 'i' || args_marshal[i] == 'f' || args_marshal[i] == 'l' || args_marshal[i] == 'd')
					extra_args_mem += 8;
			}

			var extra_args_mem = extra_args_mem ? Module._malloc (extra_args_mem) : 0;
			var extra_arg_idx = 0;
			var args_mem = Module._malloc (args.length * 4);
			var eh_throw = Module._malloc (4);
			for (var i = 0; i < args.length; ++i) {
				if (args_marshal[i] == 's') {
					Module.setValue (args_mem + i * 4, this.js_string_to_mono_string (args [i]), "i32");
				} else if (args_marshal[i] == 'm') {
					Module.setValue (args_mem + i * 4, args [i], "i32");
				} else if (args_marshal[i] == 'o') {
					Module.setValue (args_mem + i * 4, this.js_to_mono_obj (args [i]), "i32");
				} else if (args_marshal[i] == 'i' || args_marshal[i] == 'f' || args_marshal[i] == 'l' || args_marshal[i] == 'd') {
					var extra_cell = extra_args_mem + extra_arg_idx;
					extra_arg_idx += 8;

					if (args_marshal[i] == 'i')
						Module.setValue (extra_cell, args [i], "i32");
					else if (args_marshal[i] == 'l')
						Module.setValue (extra_cell, args [i], "i64");
					else if (args_marshal[i] == 'f')
						Module.setValue (extra_cell, args [i], "float");
					else
						Module.setValue (extra_cell, args [i], "double");

					Module.setValue (args_mem + i * 4, extra_cell, "i32");
				}
			}
			Module.setValue (eh_throw, 0, "i32");

			var res = this.invoke_method (method, this_arg, args_mem, eh_throw);

			var eh_res = Module.getValue (eh_throw, "i32");

			if (extra_args_mem)
				Module._free (extra_args_mem);
			Module._free (args_mem);
			Module._free (eh_throw);

			if (eh_res != 0) {
				var msg = this.conv_string (res);
				throw new Error (msg); //the convention is that invoke_method ToString () any outgoing exception
			}

			if (args_marshal.length >= args.length && args_marshal [args.length] == 'm')
				return res;
			return this.unbox_mono_obj (res);
		},

		invoke_delegate: function (delegate_obj, js_args) {
			this.bindings_lazy_init ();

			if (!this.delegate_dynamic_invoke) {
				if (!this.corlib)
					this.corlib = this.assembly_load ("mscorlib");
				if (!this.delegate_class)
					this.delegate_class = this.find_class (this.corlib, "System", "Delegate");
				this.delegate_dynamic_invoke = this.find_method (this.delegate_class, "DynamicInvoke", -1);
			}
			var mono_args = this.js_array_to_mono_array (js_args);
			return this.call_method (this.delegate_dynamic_invoke, this.extract_mono_obj (delegate_obj), "m", [ mono_args ]);
		},
		
		resolve_method_fqn: function (fqn) {
			var assembly = fqn.substring(fqn.indexOf ("[") + 1, fqn.indexOf ("]")).trim();
			fqn = fqn.substring (fqn.indexOf ("]") + 1).trim();

			var methodname = fqn.substring(fqn.indexOf (":") + 1);
			fqn = fqn.substring (0, fqn.indexOf (":")).trim ();

			var namespace = "";
			var classname = fqn;
			if (fqn.indexOf(".") != -1) {
				var idx = fqn.lastIndexOf(".");
				namespace = fqn.substring (0, idx);
				classname = fqn.substring (idx + 1);
			}

			var asm = this.assembly_load (assembly);
			if (!asm)
				throw new Error ("Could not find assembly: " + assembly);

			var klass = this.find_class(asm, namespace, classname);
			if (!klass)
				throw new Error ("Could not find class: " + namespace + ":" +classname);

			var method = this.find_method (klass, methodname, -1);
			if (!method)
				throw new Error ("Could not find method: " + methodname);
			return method;
		},

		call_static_method: function (fqn, args, signature) {
			this.bindings_lazy_init ();

			var method = this.resolve_method_fqn (fqn);

			if (typeof signature === "undefined")
				signature = Module.mono_method_get_call_signature (method);

			return this.call_method (method, null, signature, args);
		},

		bind_static_method: function (fqn, signature) {
			this.bindings_lazy_init ();

			var method = this.resolve_method_fqn (fqn);

			if (typeof signature === "undefined")
				signature = Module.mono_method_get_call_signature (method);

			return function() {
				return BINDING.call_method (method, null, signature, arguments);
			};
		},

		// Object wrapping helper functions to handle reference handles that will
		// be used in managed code.
		mono_wasm_register_obj: function(obj, is_managed) {

			if (typeof is_managed === 'undefined' && is_managed !== null)
			{
				is_managed = false;
			}
			var gc_handle = undefined;
			if (typeof obj !== "undefined" && obj !== null) {
				gc_handle = obj.__mono_gchandle__;
				if (typeof gc_handle === "undefined") {
					var handle = this.mono_wasm_free_list.length ?
								this.mono_wasm_free_list.pop() : this.mono_wasm_ref_counter++;
					obj.__mono_gchandle__ = gc_handle = handle + 1;
					
					if (is_managed)
						obj.is_clr_managed = true;
					else
						this.wasm_binding_obj_new(obj);
					
						
				}
				this.mono_wasm_object_registry[handle] = obj;
			}
			return gc_handle;
		},
		mono_wasm_require_handle: function(handle) {
			return this.mono_wasm_object_registry[handle - 1];
		},
		mono_wasm_unregister_obj: function(obj) {
	
			if (typeof obj  !== "undefined" && obj !== null) {
				var gc_handle = obj.__mono_gchandle__;
				if (typeof gc_handle  !== "undefined") {
					this.mono_wasm_free_list.push(gc_handle - 1);
					delete obj.__mono_gchandle__;
					return this.wasm_unbinding_js_obj_and_free(gc_handle);
				}
			}
			return null;
		},
		mono_wasm_free_handle: function(handle) {
			var obj = this.mono_wasm_object_registry[handle - 1]
			this.mono_wasm_unregister_obj(obj);
		},
		
		/*
		* Helper functions for managing events
		*/
		mono_wasm_event_helper: {

			add: 
			function (eventHandler)
			{
				
				var wasm_events = undefined;
				wasm_events = eventHandler.target.__mono_wasm_events__;
				if (typeof(wasm_events) === "undefined") {
					eventHandler.target.__mono_wasm_events__ = wasm_events = {};
				}

				// make sure we do not set this multiple times.
				if (wasm_events[eventHandler.uid])
					return;

				var handler = function (event) {

					// window.event - Microsoft Internet Explorer
					// window.event is a proprietary Microsoft Internet Explorer property which is only available while a 
					// DOM event handler is being called. Its value is the Event object currently being handled.
					// this may need to be used on windows and needs testing ??????
					var e = event || window.event;

					var eventStruct = BINDING.mono_wasm_event_helper.fillEventData(e, this);
					// We will register the object on our object stack so PreventDefault, StopPropogation and other info
					// methods will be available
					var eventHandle = BINDING.mono_wasm_register_obj(e);
					eventHandler.delegate(eventStruct["type"],
						eventStruct["typeOfEvent"],
						eventHandler.target,
						eventHandle,
						JSON.stringify(eventStruct)
						)

					// We are now done with the event so we need to unregister the object from our object stack
					// and free the handle for re-use. 
					BINDING.mono_wasm_unregister_obj(e);
				}
				eventHandler.target.addEventListener(eventHandler.eventTypeString, handler, false);
				wasm_events[eventHandler.uid] = handler;
			},
			remove: function( eventHandler ) {
				
				var wasm_events = undefined;
				wasm_events = eventHandler.target.__mono_wasm_events__;
				if (!wasm_events || typeof(wasm_events) === "undefined") {
					return true;
				}


				var handler = wasm_events[eventHandler.uid];
				if (!handler)
					return false;
				eventHandler.target.removeEventListener(eventHandler.eventTypeString, handler, false);
				delete wsevents[eventHandler.uid];
				return true;
			},
			fillEventData: function (e, target)
			{
				var DOMEventProps = ["type",
				"altKey",
				"bubbles",
				"cancelable",
				"changedTouches",
				"ctrlKey",
				"detail",
				"eventPhase",
				"metaKey",
				"shiftKey",
				"char",
				"charCode",
				"key",
				"keyCode",
				"pointerId",
				"pointerType",
				"screenX",
				"screenY",
				"timeStamp",
				"isTrusted",
				"scoped"]

				var eventStruct = {};
				eventStruct["typeOfEvent"] = "Event";

				DOMEventProps.forEach(function (prop) {
					eventStruct[prop] = e[prop];
				});

				if (e instanceof MouseEvent)
				{
					BINDING.mono_wasm_event_helper.fillMouseEventData(eventStruct, e, target);
				}
				else if (e instanceof UIEvent)
				{
					BINDING.mono_wasm_event_helper.fillUIEventData(eventStruct, e, target);
				}
				else if (e instanceof ClipboardEvent)
				{
					eventStruct["typeOfEvent"] = "ClipboardEvent";
				}

				return eventStruct;
			},
			fillMouseEventData: function (eventStruct, e, target)
			{
				var DOMMouseEventProps = ["pageX",
				"pageY",
				"button",
				"buttons",
				"clientX",
				"clientY",
				"offsetX",
				"offsetY",
				"layerX",
				"layerY",
				"movementX",
				"movementY",
				"metaKey",
				"which",
				"x",
				"y"]

				DOMMouseEventProps.forEach(function (prop) {
					eventStruct[prop] = e[prop];
				});

				eventStruct["typeOfEvent"] = "MouseEvent";

				if (e instanceof DragEvent)
				{
					BINDING.mono_wasm_event_helper.fillDragEventData(eventStruct, e, target);
				}
				else if (e instanceof WheelEvent)
				{
					BINDING.mono_wasm_event_helper.fillWheelEventData(eventStruct, e, target);
				}

			},        
			fillDragEventData: function (eventStruct, e, target)
			{
				var DOMDragEventProps = [];

				DOMDragEventProps.forEach(function (prop) {
					eventStruct[prop] = e[prop];
				});

				eventStruct["typeOfEvent"] = "DragEvent";
			},     
			fillUIEventData: function (eventStruct, e, target)
			{
				var DOMUIEventProps = []

				DOMUIEventProps.forEach(function (prop) {
					eventStruct[prop] = e[prop];
				});

				eventStruct["typeOfEvent"] = "UIEvent";

				if (e instanceof FocusEvent)
				{
					BINDING.mono_wasm_event_helper.fillFocusEventData(eventStruct, e, target);
				}
				if (e instanceof KeyboardEvent)
				{
					BINDING.mono_wasm_event_helper.fillKeyboardEventData(eventStruct, e, target);
				}

			},        
			fillFocusEventData: function (eventStruct, e, target)
			{
				var DOMFocusEventProps = [];

				DOMFocusEventProps.forEach(function (prop) {
					eventStruct[prop] = e[prop];
				});

				eventStruct["typeOfEvent"] = "FocusEvent";
			},     
			fillWheelEventData: function (eventStruct, e, target)
			{
				var DOMWheelEventProps = ["deltaMode",
				"deltaX",
				"deltaY",
				"deltaZ",
				"wheelDelta",
				"wheelDeltaX",
				"wheelDeltaY",
				"DOM_DELTA_LINE",
				"DOM_DELTA_PAGE",
				"DOM_DELTA_PIXEL"];

				DOMWheelEventProps.forEach(function (prop) {
					eventStruct[prop] = e[prop];
				});

				eventStruct["typeOfEvent"] = "WheelEvent";
			}, 
			fillFocusEventData: function (eventStruct, e, target)
			{
				var DOMKeyboardEventProps = ["locale",
				"location",
				"metakey",
				"repeat",
				"which",
				"code",
				"DOM_KEY_LOCATION_JOYSTICK",
				"DOM_KEY_LOCATION_LEFT",
				"DOM_KEY_LOCATION_MOBILE",
				"DOM_KEY_LOCATION_NUMPAD",
				"DOM_KEY_LOCATION_RIGHT",
				"DOM_KEY_LOCATION_STANDARD"
				];

				DOMKeyboardEventProps.forEach(function (prop) {
					eventStruct[prop] = e[prop];
				});

				eventStruct["typeOfEvent"] = "KeyboardEvent";
			},     
		
		},			
	
	},
	mono_wasm_invoke_js_with_args: function(js_handle, method_name, args, is_managed, is_exception) {
		BINDING.bindings_lazy_init ();

		var obj = BINDING.mono_wasm_require_handle (js_handle);
		if (!obj) {
			setValue (is_exception, 1, "i32");
			return BINDING.js_string_to_mono_string ("Invalid JS object handle '" + js_handle + "'");
		}

		var js_name = BINDING.conv_string (method_name);
		if (!js_name) {
			setValue (is_exception, 1, "i32");
			return BINDING.js_string_to_mono_string ("Invalid method name object '" + method_name + "'");
		}

		var js_args = BINDING.mono_array_to_js_array(args);

		var res;
		try {
			var m = obj [js_name];
			var res = m.apply (obj, js_args);
			return BINDING.js_to_mono_obj (res, is_managed);
		} catch (e) {
			var res = e.toString ();
			setValue (is_exception, 1, "i32");
			if (res === null || typeof res  === "undefined")
				res = "unknown exception";
			return BINDING.js_string_to_mono_string (res);
		}
	},
	mono_wasm_get_js_global: function(global_name, is_managed, is_exception) {
		BINDING.bindings_lazy_init ();

		var js_name = BINDING.conv_string (global_name);
		if (!js_name) {
			setValue (is_exception, 1, "i32");
			return BINDING.js_string_to_mono_string ("Invalid global object name '" + js_name + "'");
		}

		function get_global() { return (function(){return Function;})()('return this')(); }

		var globalObj = get_global()[js_name];
		if (globalObj === null || typeof globalObj === undefined) {
			setValue (is_exception, 1, "i32");
			return BINDING.js_string_to_mono_string ("Global object '" + js_name + "' not found.");
		}
		var objHandle = BINDING.mono_wasm_register_obj(globalObj, is_managed);
		return BINDING.js_to_mono_obj (objHandle, is_managed);
	},
	mono_wasm_get_js_property: function(js_handle, property_name, is_managed, is_exception) {
		BINDING.bindings_lazy_init ();

		var obj = BINDING.mono_wasm_require_handle (js_handle);
		if (!obj) {
			setValue (is_exception, 1, "i32");
			return BINDING.js_string_to_mono_string ("Invalid JS object handle '" + js_handle + "'");
		}

		var js_name = BINDING.conv_string (property_name);
		if (!js_name) {
			setValue (is_exception, 1, "i32");
			return BINDING.js_string_to_mono_string ("Invalid property name object '" + js_name + "'");
		}

		var res;
		try {
			var m = obj [js_name];
			return BINDING.js_to_mono_obj (m, is_managed);
		} catch (e) {
			var res = e.toString ();
			setValue (is_exception, 1, "i32");
			if (res === null || typeof res === "undefined")
				res = "unknown exception";
			return BINDING.js_string_to_mono_string (res);
		}
	},
    mono_wasm_set_js_property: function (js_handle, property_name, value, createIfNotExists, hasOwnProperty, is_managed) {

		BINDING.bindings_lazy_init ();

		var requireObject = BINDING.mono_wasm_require_handle (js_handle);
		if (!requireObject) {
			setValue (is_exception, 1, "i32");
			return BINDING.js_string_to_mono_string ("Invalid JS object handle '" + js_handle + "'");
		}

		var property = BINDING.conv_string (property_name);
		if (!property) {
			setValue (is_exception, 1, "i32");
			return BINDING.js_string_to_mono_string ("Invalid property name object '" + property_name + "'");
		}

        var result = false;

		var js_value = BINDING.unbox_mono_obj(value);

        if (createIfNotExists === true) {
            requireObject[property] = js_value;
            result = true;
        }
        else {
            result = false;
            if (hasOwnProperty === true) {
                if (requireObject.hasOwnProperty(property)) {
                    requireObject[property] = js_value;
                    result = true;
                }
            }
            else {
                requireObject[property] = js_value;
                result = true;
            }
        
        }
        return BINDING.call_method (BINDING.box_js_bool, null, "im", [ result ]);
    },
	mono_wasm_get_js_style_attribute: function(js_handle, attr_name, is_exception) {
		BINDING.bindings_lazy_init ();

		var obj = BINDING.mono_wasm_require_handle (js_handle);
		if (!obj) {
			setValue (is_exception, 1, "i32");
			return BINDING.js_string_to_mono_string ("Invalid JS object handle '" + js_handle + "'");
		}

		var js_name = BINDING.conv_string (attr_name);
		if (!js_name) {
			setValue (is_exception, 1, "i32");
			return BINDING.js_string_to_mono_string ("Invalid attribute name object '" + js_name + "'");
		}

		var res;
		try {
			var m = obj.style[js_name];
			return BINDING.js_to_mono_obj (m);
		} catch (e) {
			var res = e.toString ();
			setValue (is_exception, 1, "i32");
			if (res === null || typeof res === "undefined")
				res = "unknown exception";
			return BINDING.js_string_to_mono_string (res);
		}
	},
	mono_wasm_set_js_style_attribute: function(js_handle, attr_name, new_value, is_exception) {
		BINDING.bindings_lazy_init ();

		var obj = BINDING.mono_wasm_require_handle (js_handle);
		if (!obj) {
			setValue (is_exception, 1, "i32");
			return BINDING.js_string_to_mono_string ("Invalid JS object handle '" + js_handle + "'");
		}

		var attribute = BINDING.conv_string (attr_name);
		if (!attribute) {
			setValue (is_exception, 1, "i32");
			return BINDING.js_string_to_mono_string ("Invalid attribute name object '" + attribute + "'");
		}

		try {
			if (obj.style)
			{
				var js_value = BINDING.unbox_mono_obj(new_value);

				if (js_value === null || typeof js_value  === "undefined")
				{
					obj.style[attribute] = "";
				}
				else
				{
					obj.style[attribute] = js_value;
				}
			}
			return true;
		} catch (e) {
			var res = e.toString ();
			setValue (is_exception, 1, "i32");
			if (res === null || typeof res === "undefined")
				res = "unknown exception";
			return BINDING.js_string_to_mono_string (res);
		}
	
	},
	mono_wasm_add_js_event_listener: function(js_handle, event_name, mono_delegate, event_uid, is_exception) {
		BINDING.bindings_lazy_init ();

		var obj = BINDING.mono_wasm_require_handle (js_handle);
		if (!obj) {
			setValue (is_exception, 1, "i32");
			return BINDING.js_string_to_mono_string ("Invalid JS object handle '" + js_handle + "'");
		}

		var eventName = BINDING.conv_string (event_name);
		if (!eventName) {
			setValue (is_exception, 1, "i32");
			return BINDING.js_string_to_mono_string ("Invalid attribute name object '" + eventName + "'");
		}

		try {
			var eventDelegate = BINDING.unbox_mono_obj(mono_delegate);
	
			var eventHandler = {
				target: obj,
				eventTypeString: eventName,
				uid: event_uid,
				delegate: eventDelegate
			  };
			BINDING.mono_wasm_event_helper.add(eventHandler);
	

		} catch (e) {
			var res = e.toString ();
			setValue (is_exception, 1, "i32");
			if (res === null || typeof res === "undefined")
				res = "unknown exception";
			return BINDING.js_string_to_mono_string (res);
		}
	
	},

};

autoAddDeps(BindingSupportLib, '$BINDING')
mergeInto(LibraryManager.library, BindingSupportLib)

