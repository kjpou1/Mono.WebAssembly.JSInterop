using System;
using System.Reflection;

namespace Mono.WebAssembly.JSInterop
{

    public static class InteropHelpers
    {

        static public Exception NormalizeException(Exception e)
        {
            AggregateException aggregate = e as AggregateException;
            if (aggregate != null && aggregate.InnerExceptions.Count == 1)
            {
                e = aggregate.InnerExceptions[0];
            }
            else {
                TargetInvocationException target = e as TargetInvocationException;
                if (target != null && target.InnerException != null)
                {
                    e = target.InnerException;
                }
            }

            return e;
        }


        // This is simple right now and will include FlagsAttribute later.
        public static Enum EnumFromExportContract(Type enumType, object value)
        {

            if (!enumType.IsEnum)
            {
                throw new ArgumentException("Type provided must be an Enum.", nameof(enumType));
            }

            if (value is string)
            {

                var fields = enumType.GetFields();
                foreach (var fi in fields)
                {
                    ExportAttribute[] attributes =
                        (ExportAttribute[])fi.GetCustomAttributes(typeof(ExportAttribute), false);

                    var enumConversionType = ConvertEnum.Default;

                    object contractName = null;

                    if (attributes != null && attributes.Length > 0)
                    {
                        enumConversionType = attributes[0].EnumValue;
                        if (enumConversionType != ConvertEnum.Numeric)
                            contractName = attributes[0].ContractName;

                    }

                    if (contractName == null)
                        contractName = value;

                    switch (enumConversionType)
                    {
                        case ConvertEnum.ToLower:
                            contractName = contractName.ToString().ToLower();
                            break;
                        case ConvertEnum.ToUpper:
                            contractName = contractName.ToString().ToUpper();
                            break;
                        case ConvertEnum.Numeric:
                            contractName = (int)Enum.Parse(value.GetType(), contractName.ToString());
                            break;
                        default:
                            contractName = fi.Name.ToString();
                            break;
                    }

                    if (contractName.ToString() == value.ToString())
                    {
                        return (Enum)Enum.Parse(enumType, fi.Name);
                    }

                }

            }
            else
            {
                return (Enum)Enum.ToObject(enumType, value);
            }

            return null;
        }

        // This is simple right now and will include FlagsAttribute later.
        public static object EnumToExportContract(Enum value)
        {

            FieldInfo fi = value.GetType().GetField(value.ToString());

            ExportAttribute[] attributes =
                (ExportAttribute[])fi.GetCustomAttributes(typeof(ExportAttribute), false);

            var enumConversionType = ConvertEnum.Default;

            object contractName = null;

            if (attributes != null && attributes.Length > 0)
            {
                enumConversionType = attributes[0].EnumValue;
                if (enumConversionType != ConvertEnum.Numeric)
                    contractName = attributes[0].ContractName;

            }

            if (contractName == null)
                contractName = value;

            switch (enumConversionType)
            {
                case ConvertEnum.ToLower:
                    contractName = contractName.ToString().ToLower();
                    break;
                case ConvertEnum.ToUpper:
                    contractName = contractName.ToString().ToUpper();
                    break;
                case ConvertEnum.Numeric:
                    contractName = (int)Enum.Parse(value.GetType(), contractName.ToString());
                    break;
                default:
                    contractName = fi.Name.ToString();
                    break;
            }

            return contractName;
        }

        /// <summary>
        /// This an id that is unique over the lifetime of the process. It changes
        /// at each access.
        /// </summary>
        //public static double NextUID => nextUID++;

    }
}